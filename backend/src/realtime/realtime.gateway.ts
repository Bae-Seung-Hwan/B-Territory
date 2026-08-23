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
import { MinigameService } from '../duels/minigame/minigame.service';
import type {
  DuelParticipants,
  GameStartPlan,
  MiniGameOutcome,
} from '../duels/minigame/minigame.service';
import { GameSubmitDto } from '../duels/minigame/dto/game-submit.dto';
import { GAME_ROUND_TIMEOUT } from '../duels/minigame/constants';
import {
  DUEL_REQUEST_TTL,
  ENCOUNTER_COOLDOWN_TTL,
  NOTIFICATION_QUEUE_TTL,
} from '../duels/constants';
import { ErrorCode, errBody } from '../common/errors/error-code';
import { LocationLogsService } from '../location-logs/location-logs.service';
import { LocationServiceCode } from '../location-logs/constants';

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
    private readonly minigameService: MinigameService,
    private readonly locationLogs: LocationLogsService,
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
  // 알림이 유실된다 — respondToDuel/notifyUser와 동일하게 항상 최신 socketId를 조회한다).
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

    // 수락된 결투는 곧바로 미니게임으로 이어진다. 게임 종류·퀴즈 문제는 서버가 정해
    // 양쪽에 똑같이 내려보내야 두 기기가 같은 화면을 본다.
    if (accept) {
      const plan = await this.minigameService.start(duel.id);
      await this.startGameRound(duel, plan);
    }

    return { status: 'ok' };
  }

  /** game:start를 양쪽에 보내고, 이 라운드의 출발 신호와 제출 마감 타이머를 건다. */
  private async startGameRound(
    participants: DuelParticipants,
    plan: GameStartPlan,
  ): Promise<void> {
    const { payload, goDelayMs } = plan;

    // 타이머를 emit보다 먼저 건다 — emit이 실패하면(Redis 큐잉 실패 등) 세션은 이미
    // 만들어진 채 마감이 걸리지 않아, 결투가 45초 마감 대신 결투 스윕(300초)까지 매달린다.
    //
    // 인메모리 타이머라 서버 재시작 시에는 유실되지만, 그때도 sweepStaleDuels가
    // ACCEPTED를 VOID로 정리한다 (duels.service.ts#sweepStaleDuels).
    setTimeout(() => {
      void this.expireRoundAndNotify(participants, payload.round);
    }, GAME_ROUND_TIMEOUT * 1000);

    // 반응속도 게임의 출발 신호는 서버가 쏜다 — 클라이언트가 스스로 신호를 만들면
    // 자기 반응 시간을 아무 값이나 주장할 수 있다. 대기 시간은 payload에 넣지 않으므로
    // 클라이언트는 언제 켜질지 알 수 없다.
    if (goDelayMs !== null) {
      setTimeout(() => {
        void this.fireGoSignal(participants, payload.round);
      }, goDelayMs);
    }

    await this.emitToBoth(participants, 'game:start', payload);
  }

  /**
   * 반응속도 게임의 출발 신호.
   *
   * markGo가 서버 시계로 발사 시각을 먼저 기록하고, 그 다음에 emit한다 — 순서가 뒤집히면
   * 신호를 받자마자 누른 정상 제출이 부정출발로 처리된다.
   */
  private async fireGoSignal(
    participants: DuelParticipants,
    round: number,
  ): Promise<void> {
    try {
      const fired = await this.minigameService.markGo(participants.id, round);
      if (!fired) return; // 라운드가 이미 끝났거나 세션이 바뀜
      await this.emitToBoth(participants, 'game:go', {
        duelId: participants.id,
        round,
      });
    } catch (err) {
      this.logger.error(
        `미니게임 출발 신호 발사 실패 duelId=${participants.id} round=${round}`,
        err,
      );
    }
  }

  private async expireRoundAndNotify(
    participants: DuelParticipants,
    round: number,
  ): Promise<void> {
    try {
      const outcome = await this.minigameService.expireRound(
        participants.id,
        round,
      );
      if (outcome) await this.broadcastGameOutcome(outcome);
    } catch (err) {
      this.logger.error(
        `미니게임 라운드 마감 처리 실패 duelId=${participants.id} round=${round}`,
        err,
      );
    }
  }

  @SubscribeMessage('game:submit')
  async handleGameSubmit(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: GameSubmitDto,
  ) {
    const user = this.getUser(client);
    const outcome = await this.minigameService.submit(dto.duelId, user.id, dto);

    // 양쪽 다 냈지만 마감 타이머가 정산을 선점한 경우 — 그쪽이 결과를 보내므로 여기선 조용히 끝낸다.
    if (outcome.status === 'settling') return { status: 'settling' };

    if (outcome.status === 'waiting') {
      // 상대에겐 "제출했다"는 사실만 알린다 — 점수를 흘리면 나중에 내는 쪽이 맞춰서 조작한다.
      const { challengerId, opponentId } = outcome.participants;
      const waitingFor = user.id === challengerId ? opponentId : challengerId;
      await this.notifyUser(waitingFor, 'game:opponent:submitted', {
        duelId: dto.duelId,
        round: dto.round,
      });
      return { status: 'waiting' };
    }

    await this.broadcastGameOutcome(outcome);
    return { status: outcome.status };
  }

  /**
   * 라운드 정산 결과를 두 참가자에게 알린다.
   *
   * 결투가 끝나는 경우는 기존 duel:completed / duel:voided를 그대로 쓴다 — 자가신고
   * 시절 프론트가 이미 구독하고 있는 이벤트라 결과 화면을 새로 만들 필요가 없다.
   */
  private async broadcastGameOutcome(outcome: MiniGameOutcome): Promise<void> {
    const { participants } = outcome;
    if (outcome.status === 'waiting' || outcome.status === 'settling') return;

    if (outcome.status === 'rematch') {
      await this.emitToBoth(participants, 'game:round:result', {
        duelId: participants.id,
        round: outcome.plan.payload.round - 1,
        winnerId: null,
        scores: outcome.scores,
      });
      await this.startGameRound(participants, outcome.plan);
      return;
    }

    if (outcome.status === 'completed') {
      const { duel } = outcome;
      await this.emitToBoth(participants, 'duel:completed', {
        duelId: duel.id,
        winnerId: duel.winnerId,
        loserId: duel.loserId,
        scoreDelta: duel.scoreDelta,
        allyBonusApplied: duel.allyBonusApplied,
        scores: outcome.scores,
      });
      return;
    }

    await this.emitToBoth(participants, 'duel:voided', {
      duelId: participants.id,
      scores: outcome.scores,
    });
  }

  private async emitToBoth(
    participants: DuelParticipants,
    event: string,
    payload: unknown,
  ): Promise<void> {
    await Promise.all([
      this.notifyUser(participants.challengerId, event, payload),
      this.notifyUser(participants.opponentId, event, payload),
    ]);
  }
}
