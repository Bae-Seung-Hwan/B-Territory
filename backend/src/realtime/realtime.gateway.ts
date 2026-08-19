import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { WsExceptionsFilter } from '../common/filters/ws-exception.filter';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { sortedPairKey } from '../common/utils/pair-key.util';
import {
  SocketData,
  getSocketUser,
  useSocketAuth,
  wsValidationPipe,
} from '../common/ws/ws-auth';
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
import { LocationLogsService } from '../location-logs/location-logs.service';
import { LocationServiceCode } from '../location-logs/constants';

@UseFilters(WsExceptionsFilter)
@WebSocketGateway({ namespace: '/realtime', cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
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
    private readonly locationLogs: LocationLogsService,
  ) {
    // 정리 잡(duel-cleanup)이 스윕한 결투의 참가자에게 알림을 보낼 수 있도록 콜백 주입
    this.duelsService.setNotifier((userId, event, payload) =>
      this.notifyUser(userId, event, payload),
    );
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

  /**
   * 인증은 핸드셰이크 미들웨어에서 끝낸다 — 라이프사이클 훅에서 하면 클라이언트가
   * 인증 완료 전에 connect를 받아, 곧바로 보낸 이벤트가 미인증으로 거부된다.
   */
  afterInit(namespace: Namespace): void {
    useSocketAuth(
      namespace,
      this.firebaseService,
      this.usersService,
      this.logger,
    );
  }

  /**
   * 라이프사이클 훅은 반드시 자체적으로 예외를 삼켜야 한다 — @UseFilters(WsExceptionsFilter)는
   * @SubscribeMessage 핸들러에만 걸리고, @nestjs/websockets는 이 훅이 돌려준 Promise에
   * .catch를 걸지 않는다. 여기서 reject가 새어나가면 unhandledRejection이 되어 소켓 하나가
   * 접속하는 순간 프로세스 전체가 죽고, 그 시점에 붙어 있던 모든 유저가 함께 끊긴다.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      // 미들웨어를 통과한 소켓만 여기 도달하므로 user는 항상 있다.
      // 밀린 알림 재생은 emit이라 핸드셰이크가 아닌 연결 확립 후에 해야 유실되지 않는다.
      const user = getSocketUser(client);
      const pending = await this.redis.drainNotifications(user.id);
      for (const { event, payload } of pending) {
        client.emit(event, payload);
      }
    } catch (err) {
      // 여기까지 오는 건 Redis 자체가 응답하지 않는 경우다(손상된 엔트리는
      // drainNotifications가 엔트리 단위로 걸러낸다).
      //
      // 이때 연결을 끊지 않는다 — MULTI가 실패했으면 큐는 그대로 살아 있어 다음 접속에
      // 재생되고, 반대로 끊으면 장애가 지속되는 내내 접속→드레인 실패→끊김→재접속이
      // 루프를 돈다. 소켓은 살려두고 알림 재생만 포기한다.
      this.logger.warn(`밀린 알림 재생 실패: ${(err as Error).message}`);
    }
  }

  /** handleConnection과 같은 이유로 예외를 밖으로 흘리지 않는다. */
  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const user = (client.data as SocketData).user;
      if (!user) return;
      // 멀티 디바이스 대응: 메타에 등록된 최신 소켓이 아니면(다른 기기가 이후에 접속) 위치를 지우지 않는다.
      // 메타가 이미 만료된 경우에는 남은 geo 좌표만 정리한다.
      const meta = await this.redis.getUserMeta(user.id);
      if (meta && meta.socketId !== client.id) return;
      await this.redis.geoRemove(user.id);
    } catch (err) {
      // 소켓은 이미 끊긴 뒤라 복구할 게 없다 — geo 좌표는 다음 location:update나 TTL로 정리된다.
      this.logger.warn(`연결 종료 정리 실패: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: LocationUpdateDto,
  ) {
    const user = getSocketUser(client);

    // 좌표를 전송받은 시점마다 이용사실을 기록한다(법 제16조 2항). 실시간 좌표는 빈도가 높아
    // 큐 적재만 하고 응답을 막지 않는다 — 적재 실패는 LocationLogsService가 에러 로그로 남긴다.
    this.locationLogs.record({
      subjectId: user.id,
      service: LocationServiceCode.DUEL_MATCH,
    });

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
    const user = getSocketUser(client);
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
    const user = getSocketUser(client);
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
    const user = getSocketUser(client);
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
