import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { sortedPairKey } from '../common/utils/pair-key.util';
import { DuelsService } from '../duels/duels.service';
import { LocationUpdateDto } from '../duels/dto/location-update.dto';
import { DuelRequestDto } from '../duels/dto/duel-request.dto';
import { DuelRespondDto } from '../duels/dto/duel-respond.dto';
import { DuelResultDto } from '../duels/dto/duel-result.dto';
import {
  DUEL_REQUEST_TTL,
  ENCOUNTER_COOLDOWN_TTL,
  NOTIFICATION_QUEUE_TTL,
} from '../duels/constants';

interface AuthenticatedUser {
  id: string;
  team: string;
  nickname: string;
}

type SocketData = { user?: AuthenticatedUser };

// NOTE: 클래스 레벨 @UsePipes로 적용하면 @ConnectedSocket()의 Socket 파라미터까지 검증 대상이 되어
// (whitelist+forbidNonWhitelisted 조합이 class-validator 데코레이터가 없는 Socket의 모든 속성을
// "허용되지 않음"으로 판단해 예외를 던짐) 모든 핸들러가 실패한다. @MessageBody() 파라미터에만
// 개별적으로 붙여서 DTO만 검증되도록 한다.
const wsValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@WebSocketGateway({ namespace: '/realtime', cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly duelsService: DuelsService,
  ) {}

  private getUser(client: Socket): AuthenticatedUser {
    const user = (client.data as SocketData).user;
    if (!user) throw new WsException('인증되지 않은 연결입니다.');
    return user;
  }

  private setUser(client: Socket, user: AuthenticatedUser): void {
    (client.data as SocketData).user = user;
  }

  /**
   * 대상 유저의 소켓이 이 인스턴스에서 바로 확인되면 즉시 emit하고, 그렇지 않으면(메타 TTL 만료,
   * 순간적 재접속 등) Redis 큐에 쌓아둔다 — DB에는 이미 반영된 결투 상태/점수를 클라이언트가
   * 영영 못 받는 일이 없도록, 다음 접속 시 drainNotifications로 재생한다.
   */
  private async notifyUser(
    userId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    const meta = await this.redis.getUserMeta(userId);
    if (meta?.socketId) {
      this.server.to(meta.socketId).emit(event, payload);
      return;
    }
    await this.redis.queueNotification(
      userId,
      event,
      payload,
      NOTIFICATION_QUEUE_TTL,
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('missing token');

      const decoded = await this.firebaseService.verifyIdToken(token);
      const user = await this.usersService.findByFirebaseUid(decoded.uid);
      if (!user || !user.team) throw new Error('unregistered user');

      this.setUser(client, {
        id: user.id,
        team: user.team,
        nickname: user.nickname,
      });

      const pending = await this.redis.drainNotifications(user.id);
      for (const { event, payload } of pending) {
        client.emit(event, payload);
      }
    } catch (err) {
      this.logger.warn(`연결 거부: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user = (client.data as SocketData).user;
    if (user) await this.redis.geoRemove(user.id);
  }

  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: LocationUpdateDto,
  ) {
    const user = this.getUser(client);
    await this.redis.geoAdd(user.id, dto.lat, dto.lng, user.team, client.id);

    const opponents = await this.duelsService.findNearbyOpponents(
      user.id,
      user.team,
      dto.lat,
      dto.lng,
    );

    for (const opponent of opponents) {
      const isNewEncounter = await this.redis.tryAcquireLock(
        sortedPairKey('encounter:cooldown', user.id, opponent.userId),
        ENCOUNTER_COOLDOWN_TTL,
      );
      if (!isNewEncounter) continue;

      const opponentUser = await this.usersService.findById(opponent.userId);

      client.emit('encounter:detected', {
        userId: opponent.userId,
        nickname: opponentUser?.nickname ?? null,
        team: opponent.team,
      });
      await this.notifyUser(opponent.userId, 'encounter:detected', {
        userId: user.id,
        nickname: user.nickname,
        team: user.team,
      });
    }

    return { status: 'ok' };
  }

  @SubscribeMessage('duel:request')
  async handleDuelRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: DuelRequestDto,
  ) {
    const user = this.getUser(client);
    const duel = await this.duelsService.requestDuel(user, dto.targetUserId);

    await this.notifyUser(dto.targetUserId, 'duel:requested', {
      duelId: duel.id,
      fromUserId: user.id,
      fromNickname: user.nickname,
    });

    setTimeout(() => {
      void this.expireAndNotify(duel.id, user.id, dto.targetUserId);
    }, DUEL_REQUEST_TTL * 1000);

    return { status: 'ok', duelId: duel.id };
  }

  // 타이머 발화 시점의 소켓id를 재조회한다 (요청 시점에 캡처해두면 그 사이 재접속한 클라이언트에게
  // 알림이 유실된다 — respondToDuel/handleDuelResult와 동일하게 항상 최신 socketId를 조회한다).
  private async expireAndNotify(
    duelId: number,
    challengerId: string,
    opponentId: string,
  ): Promise<void> {
    try {
      const expired = await this.duelsService.expireDuel(duelId);
      if (!expired) return;
      const payload = { duelId };
      await Promise.all([
        this.notifyUser(challengerId, 'duel:expired', payload),
        this.notifyUser(opponentId, 'duel:expired', payload),
      ]);
    } catch (err) {
      this.logger.error(`결투 만료 처리 실패 duelId=${duelId}`, err);
    }
  }

  @SubscribeMessage('duel:accept')
  async handleDuelAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: DuelRespondDto,
  ) {
    return this.respondToDuel(client, dto.duelId, true);
  }

  @SubscribeMessage('duel:reject')
  async handleDuelReject(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: DuelRespondDto,
  ) {
    return this.respondToDuel(client, dto.duelId, false);
  }

  private async respondToDuel(client: Socket, duelId: number, accept: boolean) {
    const user = this.getUser(client);
    const duel = await this.duelsService.respondDuel(duelId, user.id, accept);

    const event = accept ? 'duel:accepted' : 'duel:rejected';
    const payload = { duelId: duel.id };
    client.emit(event, payload);
    await this.notifyUser(duel.challengerId, event, payload);

    return { status: 'ok' };
  }

  @SubscribeMessage('duel:result')
  async handleDuelResult(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: DuelResultDto,
  ) {
    const user = this.getUser(client);
    const outcome = await this.duelsService.submitResult(
      dto.duelId,
      user.id,
      dto.winnerId,
    );

    if (outcome.status === 'waiting') return { status: 'waiting' };

    const { duel } = outcome;
    const event =
      outcome.status === 'confirmed' ? 'duel:completed' : 'duel:voided';
    const payload =
      outcome.status === 'confirmed'
        ? {
            duelId: duel.id,
            winnerId: duel.winnerId,
            loserId: duel.loserId,
            scoreDelta: duel.scoreDelta,
            allyBonusApplied: duel.allyBonusApplied,
          }
        : { duelId: duel.id };

    await Promise.all([
      this.notifyUser(duel.challengerId, event, payload),
      this.notifyUser(duel.opponentId, event, payload),
    ]);

    return { status: outcome.status };
  }
}
