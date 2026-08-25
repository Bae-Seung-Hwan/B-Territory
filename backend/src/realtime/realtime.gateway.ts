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
import { MinigameService } from '../duels/minigame/minigame.service';
import type {
  DuelParticipants,
  GameStartPlan,
  MiniGameOutcome,
} from '../duels/minigame/minigame.service';
import { GameSubmitDto } from '../duels/minigame/dto/game-submit.dto';
import { ErrorCode, errBody } from '../common/errors/error-code';
import {
  GAME_EXPIRE_MAX_ATTEMPTS,
  GAME_EXPIRE_RETRY_MS,
  GAME_ROUND_TIMEOUT,
  GAME_SETTLE_GRACE_MS,
} from '../duels/minigame/constants';
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
    private readonly minigameService: MinigameService,
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
    /**
     * 라운드가 살아 있는 동안에만 의미가 있는 이벤트(game:start·game:go)는 큐에 넣지
     * 않는다. 큐 보관은 30분(NOTIFICATION_QUEUE_TTL = PENALTY_TTL)인데 라운드는 45초라,
     * 수락 시점에 잠깐 끊겼던 참가자가 한참 뒤 재접속해서 이미 지난 deadlineAt을 가진
     * game:start를 재생받고 끝난 결투의 게임 화면을 연다. 못 받으면 미제출로 기권패인데,
     * 그건 원래 정의된 결과다.
     */
    ephemeral = false,
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
    if (ephemeral) return;
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
    const user = getSocketUser(client);
    const duel = await this.duelsService.respondDuel(duelId, user.id, accept);

    const event = accept ? 'duel:accepted' : 'duel:rejected';
    const payload = { duelId: duel.id };
    client.emit(event, payload);
    await this.notifyUser(duel.challengerId, event, payload);

    // 수락된 결투는 곧바로 미니게임으로 이어진다. 게임 종류·퀴즈 문제는 서버가 정해
    // 양쪽에 똑같이 내려보내야 두 기기가 같은 화면을 본다.
    //
    // 반드시 감싼다 — 여기서 예외가 새면 duel:accept의 ack 콜백이 아예 호출되지 않는다.
    // 양쪽은 이미 duel:accepted를 받았는데 game:start는 영영 오지 않고, 마감 타이머도
    // 걸리지 않아 결투가 스윕(약 360초)까지 매달린다. 다른 타이머 경로(fireGoSignal·
    // expireRoundAndNotify)가 같은 이유로 몸통을 감싸고 있다.
    if (accept) {
      try {
        const plan = await this.minigameService.start(duel);
        await this.startGameRound(duel, plan);
      } catch (err) {
        this.logger.error(`미니게임 시작 실패 duelId=${duel.id}`, err);
        await this.voidAfterGameStartFailure(duel);
        return {
          status: 'error',
          ...errBody(
            ErrorCode.MINIGAME_START_FAILED,
            '미니게임을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
          ),
        };
      }
    }

    return { status: 'ok' };
  }

  /**
   * 미니게임을 시작하지 못한 결투를 즉시 정리한다.
   *
   * 세션도 마감 타이머도 없이 ACCEPTED로 남겨두면 스윕이 걷어갈 때까지 두 사람 모두
   * 새 결투를 걸 수 없다(hasActiveDuel에 잡힌다). 무효 처리 자체가 또 실패할 수 있으므로
   * (같은 장애가 원인일 가능성이 높다) 여기서도 예외를 삼키고 로그만 남긴다 — 그 경우엔
   * 스윕이 최종 안전망이다.
   */
  private async voidAfterGameStartFailure(
    participants: DuelParticipants,
  ): Promise<void> {
    try {
      // 세션을 남기면 이미 걸린 go 타이머가 VOID된 결투에 game:go를 쏜다.
      await this.minigameService.discardSession(participants.id);
      await this.duelsService.voidByGame(participants.id);
      await this.emitToBoth(participants, 'duel:voided', {
        duelId: participants.id,
      });
    } catch (err) {
      this.logger.error(
        `미니게임 시작 실패 후 무효 처리도 실패 duelId=${participants.id} — 스윕에 맡긴다`,
        err,
      );
    }
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
    setTimeout(
      () => {
        void this.expireRoundAndNotify(participants, payload.round);
      },
      GAME_ROUND_TIMEOUT * 1000 + GAME_SETTLE_GRACE_MS,
    );

    // 반응속도 게임의 출발 신호는 서버가 쏜다 — 클라이언트가 스스로 신호를 만들면
    // 자기 반응 시간을 아무 값이나 주장할 수 있다. 대기 시간은 payload에 넣지 않으므로
    // 클라이언트는 언제 켜질지 알 수 없다.
    if (goDelayMs !== null) {
      setTimeout(() => {
        void this.fireGoSignal(participants, payload.round);
      }, goDelayMs);
    }

    await this.emitToBoth(participants, 'game:start', payload, true);
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
      await this.emitToBoth(
        participants,
        'game:go',
        { duelId: participants.id, round },
        true,
      );
    } catch (err) {
      this.logger.error(
        `미니게임 출발 신호 발사 실패 duelId=${participants.id} round=${round}`,
        err,
      );
    }
  }

  /**
   * 마감 처리는 실패하면 스스로 재시도해야 한다.
   *
   * settle()은 정산이 실패하면 정산 권리를 반납해 "마감 타이머가 다시 시도할 수 있게"
   * 해두지만, 타이머는 일회성 setTimeout이라 스스로는 다시 발화하지 않는다. 미제출 쪽은
   * 이미 자리를 떠 재시도를 트리거할 사람도 없어, 재시도가 없으면 권리 반납이 무의미하고
   * 결투가 스윕까지 매달린다.
   */
  private async expireRoundAndNotify(
    participants: DuelParticipants,
    round: number,
    attempt = 1,
  ): Promise<void> {
    try {
      const outcome = await this.minigameService.expireRound(
        participants.id,
        round,
      );
      if (outcome) await this.broadcastGameOutcome(outcome);
    } catch (err) {
      this.logger.error(
        `미니게임 라운드 마감 처리 실패 duelId=${participants.id} round=${round} (${attempt}/${GAME_EXPIRE_MAX_ATTEMPTS})`,
        err,
      );
      if (attempt >= GAME_EXPIRE_MAX_ATTEMPTS) {
        this.logger.error(
          `미니게임 라운드 마감 재시도 소진 duelId=${participants.id} round=${round} — 결투 스윕에 맡긴다`,
        );
        return;
      }
      setTimeout(() => {
        void this.expireRoundAndNotify(participants, round, attempt + 1);
      }, GAME_EXPIRE_RETRY_MS);
    }
  }

  @SubscribeMessage('game:submit')
  async handleGameSubmit(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: GameSubmitDto,
  ) {
    // 인증 조회는 develop이 ws-auth로 공용화한 getSocketUser를 쓰고(로컬 getUser는 사라졌다),
    // 판정은 이 브랜치가 도입한 서버 판정(minigameService.submit)을 쓴다.
    // develop 쪽 submitResult는 자가신고 경로라 이 브랜치에서 폐기한 것이다.
    const user = getSocketUser(client);
    const outcome = await this.minigameService.submit(dto.duelId, user.id, dto);

    // 양쪽 다 냈지만 마감 타이머가 정산을 선점한 경우 — 그쪽이 결과를 보내므로 여기선 조용히 끝낸다.
    if (outcome.status === 'settling') return { status: 'settling' };

    if (outcome.status === 'waiting') {
      // 상대에겐 "제출했다"는 사실만 알린다 — 점수를 흘리면 나중에 내는 쪽이 맞춰서 조작한다.
      const { challengerId, opponentId } = outcome.participants;
      const waitingFor = user.id === challengerId ? opponentId : challengerId;
      // game:start·game:go와 같은 라운드 한정 이벤트다 — 큐에 넣지 않는다(notifyUser 주석).
      await this.notifyUser(
        waitingFor,
        'game:opponent:submitted',
        { duelId: dto.duelId, round: dto.round },
        true,
      );
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
      // 지난 라운드 결과 통보가 실패해도 다음 라운드는 반드시 열어야 한다.
      //
      // 이 시점엔 decide()가 이미 round+1 세션을 써둔 상태다. 여기서 예외가 나가면
      // startGameRound가 실행되지 않아 새 라운드에 game:start도 마감 타이머도 없고,
      // 호출측의 재시도는 expireRound(round)를 다시 부를 뿐인데 세션은 이미 다음
      // 라운드라 라운드 불일치로 no-op이 된다 — 결투가 스윕까지 매달린다.
      // (startGameRound가 "타이머를 emit보다 먼저" 거는 불변식도 같은 이유다)
      // 지난 라운드의 결과 화면이라 라운드 한정이다 — 큐잉하면 재접속한 유저가 이미
      // 끝난 결투의 중간 라운드 결과를 본다. 결투 종료 통보(duel:completed·duel:voided)만
      // 나중에 받아도 의미가 있어 그쪽은 큐에 남긴다.
      await this.emitToBoth(
        participants,
        'game:round:result',
        {
          duelId: participants.id,
          round: outcome.plan.payload.round - 1,
          winnerId: null,
          scores: outcome.scores,
        },
        true,
      ).catch((err) => {
        this.logger.error(
          `라운드 결과 통보 실패 duelId=${participants.id} round=${outcome.plan.payload.round - 1} — 다음 라운드는 계속 진행한다`,
          err,
        );
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
    ephemeral = false,
  ): Promise<void> {
    await Promise.all([
      this.notifyUser(participants.challengerId, event, payload, ephemeral),
      this.notifyUser(participants.opponentId, event, payload, ephemeral),
    ]);
  }
}
