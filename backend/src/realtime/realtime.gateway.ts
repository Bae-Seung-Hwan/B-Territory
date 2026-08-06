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
import { Logger, UseFilters, ValidationPipe } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { WsExceptionsFilter } from '../common/filters/ws-exception.filter';
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
import { ErrorCode, errBody } from '../common/errors/error-code';

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

@UseFilters(WsExceptionsFilter)
@WebSocketGateway({ namespace: '/realtime', cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  // namespace를 지정한 게이트웨이에는 Server가 아닌 해당 Namespace 인스턴스가 주입된다.
  // (sockets Map으로 개별 소켓의 연결 상태를 확인하기 위해 정확한 타입을 쓴다)
  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly duelsService: DuelsService,
  ) {
    // 정리 잡(duel-cleanup)이 스윕한 결투의 참가자에게 알림을 보낼 수 있도록 콜백 주입
    this.duelsService.setNotifier((userId, event, payload) =>
      this.notifyUser(userId, event, payload),
    );
  }

  private getUser(client: Socket): AuthenticatedUser {
    const user = (client.data as SocketData).user;
    if (!user)
      throw new WsException(
        errBody(
          ErrorCode.UNAUTHENTICATED_CONNECTION,
          '인증되지 않은 연결입니다.',
        ),
      );
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
    // 메타의 socketId가 살아있는 소켓인지 확인한다 — 네트워크 단절 후 ping 타임아웃으로
    // disconnect가 발화하기 전까지 메타는 죽은 소켓을 가리키므로, 무조건 emit하면
    // 알림이 큐잉조차 되지 않고 소실된다. (단일 인스턴스 전제 — 스케일아웃 시 어댑터 필요)
    const meta = await this.redis.getUserMeta(userId);
    const socket = meta ? this.server.sockets.get(meta.socketId) : undefined;
    if (socket?.connected) {
      socket.emit(event, payload);
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
    if (!user) return;
    // 멀티 디바이스 대응: 메타에 등록된 최신 소켓이 아니면(다른 기기가 이후에 접속) 위치를 지우지 않는다.
    // 메타가 이미 만료된 경우에는 남은 geo 좌표만 정리한다.
    const meta = await this.redis.getUserMeta(user.id);
    if (meta && meta.socketId !== client.id) return;
    await this.redis.geoRemove(user.id);
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

    // 쿨다운 획득 → 닉네임 일괄 조회 → 알림을 상대별 병렬로 처리한다
    // (상대 수에 비례하는 직렬 DB/Redis 왕복을 피한다)
    const newEncounters = (
      await Promise.all(
        opponents.map(async (opponent) =>
          (await this.redis.tryAcquireLock(
            sortedPairKey('encounter:cooldown', user.id, opponent.userId),
            ENCOUNTER_COOLDOWN_TTL,
          ))
            ? opponent
            : null,
        ),
      )
    ).filter((o) => o !== null);

    if (newEncounters.length > 0) {
      const nicknameById = new Map(
        (
          await this.usersService.findByIds(newEncounters.map((o) => o.userId))
        ).map((u) => [u.id, u.nickname]),
      );

      await Promise.all(
        newEncounters.map((opponent) => {
          client.emit('encounter:detected', {
            userId: opponent.userId,
            nickname: nicknameById.get(opponent.userId) ?? null,
            team: opponent.team,
          });
          return this.notifyUser(opponent.userId, 'encounter:detected', {
            userId: user.id,
            nickname: user.nickname,
            team: user.team,
          });
        }),
      );
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
