import { RealtimeGateway } from './realtime.gateway';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { DuelsService } from '../duels/duels.service';
import { DuelStatus } from '../duels/entities/duel.entity';
import {
  GAME_EXPIRE_MAX_ATTEMPTS,
  GAME_EXPIRE_RETRY_MS,
} from '../duels/minigame/constants';
import { DUEL_REQUEST_TTL } from '../duels/constants';

interface MockSocket {
  id: string;
  data: { user?: { id: string; team: string; nickname: string } };
  emit: jest.Mock;
  disconnect: jest.Mock;
}

function mockSocket(withUser = true): MockSocket {
  return {
    id: 'sock-1',
    data: withUser
      ? { user: { id: 'user-1', team: 'KR', nickname: '테스터' } }
      : {},
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('RealtimeGateway 라이프사이클 훅', () => {
  let gateway: RealtimeGateway;
  let redis: {
    drainNotifications: jest.Mock;
    getUserMeta: jest.Mock;
    geoRemove: jest.Mock;
  };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    redis = {
      drainNotifications: jest.fn().mockResolvedValue([]),
      getUserMeta: jest.fn().mockResolvedValue(null),
      geoRemove: jest.fn().mockResolvedValue(undefined),
    };
    gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      {} as unknown as UsersService,
      redis as unknown as RedisService,
      { setNotifier: jest.fn() } as unknown as DuelsService,
      // 이 스펙은 라이프사이클 훅만 다뤄 미니게임 경로를 타지 않는다.
      {} as never,
      { record: jest.fn() } as never,
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );
    // 훅이 예외를 삼키고 로그만 남기는지 확인해야 하므로 로거 출력을 가로챈다.
    warn = jest
      .spyOn(gateway['logger'], 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('handleConnection', () => {
    it('밀린 알림을 순서대로 재생한다', async () => {
      redis.drainNotifications.mockResolvedValue([
        { event: 'duel:result', payload: { winner: 'user-1' } },
        { event: 'score:update', payload: { delta: 10 } },
      ]);
      const client = mockSocket();

      await gateway.handleConnection(client as never);

      expect(client.emit.mock.calls).toEqual([
        ['duel:result', { winner: 'user-1' }],
        ['score:update', { delta: 10 }],
      ]);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    // 회귀 가드: 이 훅은 WsExceptionsFilter의 보호를 받지 않고 NestJS가 반환 Promise에
    // .catch를 걸지 않는다. reject가 새어나가면 unhandledRejection으로 프로세스가 죽는다.
    it('드레인이 실패해도 reject하지 않는다', async () => {
      redis.drainNotifications.mockRejectedValue(new Error('Redis 응답 없음'));
      const client = mockSocket();

      await expect(
        gateway.handleConnection(client as never),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalled();
    });

    // 끊으면 장애가 지속되는 동안 재접속 루프가 돈다. 큐는 MULTI가 실패했으면 살아 있다.
    it('드레인이 실패해도 연결은 유지한다', async () => {
      redis.drainNotifications.mockRejectedValue(new Error('Redis 응답 없음'));
      const client = mockSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('메타가 최신 소켓을 가리키면 geo 좌표를 지운다', async () => {
      redis.getUserMeta.mockResolvedValue({ socketId: 'sock-1' });

      await gateway.handleDisconnect(mockSocket() as never);

      expect(redis.geoRemove).toHaveBeenCalledWith('user-1');
    });

    it('다른 기기가 이후에 접속했으면 좌표를 지우지 않는다', async () => {
      redis.getUserMeta.mockResolvedValue({ socketId: 'sock-2' });

      await gateway.handleDisconnect(mockSocket() as never);

      expect(redis.geoRemove).not.toHaveBeenCalled();
    });

    it('정리에 실패해도 reject하지 않는다', async () => {
      redis.getUserMeta.mockRejectedValue(new Error('Redis 연결 끊김'));

      await expect(
        gateway.handleDisconnect(mockSocket() as never),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalled();
    });
  });
});

/**
 * 미니게임을 시작하는 경로와 마감하는 경로는 실패해도 결투를 매달리게 두면 안 된다.
 * 세션·마감 타이머 없이 ACCEPTED로 남으면 두 사람 모두 스윕(약 360초)까지 새 결투를
 * 걸 수 없다.
 */
describe('RealtimeGateway 미니게임 시작·마감 실패 처리', () => {
  const duel = { id: 7, challengerId: 'user-1', opponentId: 'user-2' };

  function make() {
    const duelsService = {
      setNotifier: jest.fn(),
      respondDuel: jest.fn().mockResolvedValue(duel),
      voidByGame: jest.fn().mockResolvedValue(duel),
    };
    const minigameService = {
      start: jest.fn(),
      expireRound: jest.fn(),
      discardSession: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      {} as unknown as UsersService,
      {
        getUserMeta: jest.fn().mockResolvedValue(null),
        queueNotification: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService,
      duelsService as unknown as DuelsService,
      minigameService as never,
      { record: jest.fn() } as never,
      // 이 스펙들은 소켓 세션 훅을 타지 않는다 — 생성자 시그니처만 맞춘다.
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );
    const error = jest
      .spyOn(gateway['logger'], 'error')
      .mockImplementation(() => undefined);
    return { gateway, duelsService, minigameService, error };
  }

  /**
   * 예외가 핸들러 밖으로 새면 duel:accept의 ack 콜백이 아예 호출되지 않는다. 양쪽은 이미
   * duel:accepted를 받았는데 game:start는 영영 오지 않아 결투가 그대로 매달린다.
   */
  it('미니게임 시작이 실패해도 ack를 돌려주고 결투를 무효 처리한다', async () => {
    const { gateway, duelsService, minigameService } = make();
    minigameService.start.mockRejectedValue(new Error('Redis 응답 없음'));
    duelsService.voidByGame.mockResolvedValue({
      ...duel,
      requestId: null,
      status: DuelStatus.VOID,
      revision: 2,
    });
    const notify = jest.spyOn(
      gateway as unknown as { notifyUser: (...a: unknown[]) => Promise<void> },
      'notifyUser',
    );
    const client = mockSocket();

    const ack = await gateway.handleDuelAccept(client as never, {
      duelId: duel.id,
    });

    expect(ack).toMatchObject({
      status: 'error',
      code: 'MINIGAME_START_FAILED',
    });
    // ACCEPTED로 남기면 두 사람 모두 새 결투를 걸지 못한다.
    expect(duelsService.voidByGame).toHaveBeenCalledWith(duel.id);
    // duel:voided의 revision은 무효 전이가 RETURNING으로 돌려준 값이다 — 수락 때의
    // duel:accepted(revision 1)보다 커야 클라이언트가 버리지 않는다.
    expect(notify).toHaveBeenCalledWith(
      duel.challengerId,
      'duel:voided',
      expect.objectContaining({
        duelId: duel.id,
        state: DuelStatus.VOID,
        revision: 2,
      }),
      false,
    );
    // 세션을 남기면 이미 걸린 go 타이머가 VOID된 결투에 game:go를 쏜다.
    expect(minigameService.discardSession).toHaveBeenCalledWith(duel.id);
  });

  /**
   * 재경기 라운드는 decide()가 이미 세션을 써둔 뒤라, 지난 라운드 결과 통보가 실패했다고
   * 여기서 멈추면 새 라운드에 game:start도 마감 타이머도 없다. 호출측 재시도는
   * expireRound(지난 라운드)를 다시 부를 뿐이라 라운드 불일치로 no-op이 된다.
   */
  it('지난 라운드 결과 통보가 실패해도 재경기 라운드는 연다', async () => {
    // startGameRound가 45초짜리 마감 타이머를 걸어 실제 타이머가 남으면 스위트가 끝나지 않는다.
    jest.useFakeTimers();
    const { gateway, minigameService } = make();
    const plan = {
      payload: { duelId: duel.id, round: 2, gameType: 'TAP' },
      goDelayMs: null,
    };
    minigameService.expireRound.mockResolvedValue({
      status: 'rematch',
      plan,
      scores: [],
      participants: duel,
    });
    // game:round:result만 실패시키고 game:start는 통과시킨다.
    const emitToBoth = jest
      .spyOn(
        gateway as unknown as {
          emitToBoth: (...a: unknown[]) => Promise<void>;
        },
        'emitToBoth',
      )
      .mockImplementation((_p: unknown, event: unknown) =>
        event === 'game:round:result'
          ? Promise.reject(new Error('emit 실패'))
          : Promise.resolve(),
      );

    await gateway['expireRoundAndNotify'](duel, 1);

    const events = emitToBoth.mock.calls.map((c) => c[1]);
    expect(events).toContain('game:start');
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /**
   * 큐 보관은 30분(NOTIFICATION_QUEUE_TTL)인데 라운드는 45초다. 큐에 넣으면 잠깐 끊겼던
   * 참가자가 한참 뒤 재접속해서 이미 지난 deadlineAt을 가진 game:start를 재생받는다.
   */
  it('game:start는 오프라인 참가자에게 큐잉하지 않는다', async () => {
    jest.useFakeTimers();
    const queueNotification = jest.fn().mockResolvedValue(undefined);
    const duelsService = {
      setNotifier: jest.fn(),
      respondDuel: jest.fn().mockResolvedValue(duel),
      voidByGame: jest.fn().mockResolvedValue(duel),
    };
    const gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      {} as unknown as UsersService,
      // 양쪽 다 오프라인 — 원래라면 두 건 모두 큐에 쌓인다.
      {
        getUserMeta: jest.fn().mockResolvedValue(null),
        queueNotification,
      } as unknown as RedisService,
      duelsService as unknown as DuelsService,
      {
        start: jest.fn().mockResolvedValue({
          payload: { duelId: duel.id, round: 1, gameType: 'TAP' },
          goDelayMs: null,
        }),
        discardSession: jest.fn(),
      } as never,
      { record: jest.fn() } as never,
      // 이 스펙들은 소켓 세션 훅을 타지 않는다 — 생성자 시그니처만 맞춘다.
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );

    await gateway.handleDuelAccept(mockSocket() as never, { duelId: duel.id });

    const queued = (queueNotification.mock.calls as unknown[][]).map(
      (c) => c[1] as string,
    );
    expect(queued).not.toContain('game:start');
    // 결투 수락 자체는 늦게라도 알아야 하므로 큐에 남는다.
    expect(queued).toContain('duel:accepted');
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /**
   * game:start와 같은 성질의 라운드 한정 이벤트다 — 45초짜리 라운드의 "상대가 제출했다"를
   * 30분 큐에 넣으면, 재접속한 유저가 이미 끝난 결투에 대해 대기 UI를 띄운다.
   */
  it('game:opponent:submitted도 큐잉하지 않는다', async () => {
    const queueNotification = jest.fn().mockResolvedValue(undefined);
    const gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      {} as unknown as UsersService,
      {
        getUserMeta: jest.fn().mockResolvedValue(null),
        queueNotification,
      } as unknown as RedisService,
      { setNotifier: jest.fn() } as unknown as DuelsService,
      {
        submit: jest.fn().mockResolvedValue({
          status: 'waiting',
          participants: {
            id: duel.id,
            challengerId: duel.challengerId,
            opponentId: duel.opponentId,
          },
        }),
      } as never,
      { record: jest.fn() } as never,
      // 이 스펙들은 소켓 세션 훅을 타지 않는다 — 생성자 시그니처만 맞춘다.
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );

    const result = await gateway.handleGameSubmit(mockSocket() as never, {
      duelId: duel.id,
      round: 1,
    });

    expect(result).toEqual({ status: 'waiting' });
    expect(queueNotification).not.toHaveBeenCalled();
  });

  it('무효 처리까지 실패해도 ack는 돌려준다', async () => {
    const { gateway, duelsService, minigameService } = make();
    minigameService.start.mockRejectedValue(new Error('Redis 응답 없음'));
    duelsService.voidByGame.mockRejectedValue(new Error('DB 응답 없음'));
    const client = mockSocket();

    const ack = await gateway.handleDuelAccept(client as never, {
      duelId: duel.id,
    });

    expect(ack).toMatchObject({ status: 'error' });
  });

  /**
   * settle()은 정산 실패 시 권리를 반납해 "마감 타이머가 다시 시도할 수 있게" 해두지만,
   * setTimeout은 한 번만 발화한다. 재시도를 걸지 않으면 그 반납이 무의미하다.
   */
  it('마감 처리가 실패하면 재시도한다', async () => {
    jest.useFakeTimers();
    try {
      const { gateway, minigameService } = make();
      minigameService.expireRound
        .mockRejectedValueOnce(new Error('Redis 응답 없음'))
        .mockResolvedValueOnce(null);

      await gateway['expireRoundAndNotify'](duel, 1);
      expect(minigameService.expireRound).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(GAME_EXPIRE_RETRY_MS);
      expect(minigameService.expireRound).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('재시도를 소진하면 더 시도하지 않는다', async () => {
    jest.useFakeTimers();
    try {
      const { gateway, minigameService } = make();
      minigameService.expireRound.mockRejectedValue(
        new Error('Redis 응답 없음'),
      );

      await gateway['expireRoundAndNotify'](duel, 1);
      await jest.advanceTimersByTimeAsync(
        GAME_EXPIRE_RETRY_MS * (GAME_EXPIRE_MAX_ATTEMPTS + 2),
      );

      expect(minigameService.expireRound).toHaveBeenCalledTimes(
        GAME_EXPIRE_MAX_ATTEMPTS,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * 무응답 페널티는 "초대를 받고도 응답하지 않았다"에 대한 청구다.
 *
 * 그 전제는 **emit 시점에** 확정된다 — duel:requested가 살아 있는 소켓으로 나갔으면
 * 초대는 화면에 떴고, 큐로 갔으면 뜬 적이 없다. 예전에는 만료 시점(T+30s)에 소켓 생존을
 * 다시 읽어 판단했는데, 끊김은 ping timeout만큼 늦게 드러나므로 창 후반부의 단절을
 * 놓쳤고 타이머가 유실되면 확인할 방법조차 없었다. 이제 게이트웨이는 전달 여부만
 * 기록하고(markInviteDelivered), 청구 판단은 DB 값을 보는 expireDuel이 한다.
 */
describe('duel:requested 전달 기록', () => {
  const duelId = 11;
  const targetUserId = 'user-2';
  const pendingState = {
    duelId,
    requestId: null,
    state: DuelStatus.PENDING,
    revision: 0,
  };

  function make(opponentSocket: { connected: boolean } | undefined) {
    const socket = opponentSocket && { ...opponentSocket, emit: jest.fn() };
    const queueNotification = jest.fn().mockResolvedValue(undefined);
    const markInviteDelivered = jest.fn().mockResolvedValue(undefined);
    const requestDuel = jest.fn().mockResolvedValue({
      duel: {
        id: duelId,
        challengerId: 'user-1',
        opponentId: targetUserId,
        requestId: null,
        status: DuelStatus.PENDING,
        revision: 0,
      },
      created: true,
    });
    const findState = jest.fn().mockResolvedValue(pendingState);
    const syncDuel = jest.fn().mockResolvedValue(null);
    const expireDuel = jest.fn().mockResolvedValue(null);
    const gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      {} as unknown as UsersService,
      {
        getUserMeta: jest.fn().mockResolvedValue({
          team: 'JP',
          socketId: 'sock-opponent',
        }),
        queueNotification,
      } as unknown as RedisService,
      {
        setNotifier: jest.fn(),
        requestDuel,
        findState,
        syncDuel,
        expireDuel,
        markInviteDelivered,
      } as unknown as DuelsService,
      { start: jest.fn(), discardSession: jest.fn() } as never,
      { record: jest.fn() } as never,
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );
    gateway.server = {
      sockets: new Map(socket ? [['sock-opponent', socket]] : []),
    } as never;
    const client = {
      data: { user: { id: 'user-1', team: 'KR', nickname: 'me' } },
    } as never;
    return {
      gateway,
      client,
      markInviteDelivered,
      queueNotification,
      socket,
      requestDuel,
      findState,
      syncDuel,
      expireDuel,
    };
  }

  /**
   * 초대 전송은 ack 뒤(setImmediate)로 밀려 있다. 가짜 타이머에서는 0ms를 비동기로
   * 진행시켜야 그 콜백이 돈다 — runOnlyPendingTimers를 쓰면 30초 만료 타이머까지 함께
   * 터져 이 describe가 검증하려는 것과 다른 경로가 섞인다.
   */
  const flushInvite = () => jest.advanceTimersByTimeAsync(0);

  afterEach(() => {
    jest.useRealTimers();
  });

  it('살아 있는 소켓으로 초대가 나가면 전달로 기록한다', async () => {
    jest.useFakeTimers();
    const { gateway, client, markInviteDelivered, socket } = make({
      connected: true,
    });

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    // 초대에도 ack·이벤트와 같은 상태 필드가 실린다 — emit 직전에 읽은 값이다.
    expect(socket!.emit).toHaveBeenCalledWith('duel:requested', {
      ...pendingState,
      fromUserId: 'user-1',
      fromNickname: 'me',
    });
    expect(markInviteDelivered).toHaveBeenCalledWith(duelId);
  });

  // 메타 TTL(120초)이 남아 있어 신청 자체는 통과했지만, 정작 소켓은 사라진 케이스다.
  it('상대 소켓이 사라지면 전달로 기록하지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, markInviteDelivered } = make(undefined);

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(markInviteDelivered).not.toHaveBeenCalled();
  });

  // ping 타임아웃 전이라 Map에는 남아 있지만 connected가 내려간 소켓.
  it('소켓이 남아 있어도 connected가 아니면 전달로 기록하지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, markInviteDelivered } = make({ connected: false });

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(markInviteDelivered).not.toHaveBeenCalled();
  });

  /**
   * 초대는 30초(DUEL_REQUEST_TTL)짜리인데 알림 큐는 30분(NOTIFICATION_QUEUE_TTL)을 보관한다.
   * 큐에 넣으면 20분 뒤 접속한 유저가 이미 EXPIRED된 결투의 초대 모달을 받고, 곧이어
   * 재생되는 duel:expired에 그 모달이 사라진다.
   */
  it('전달하지 못한 초대는 큐에 쌓지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, queueNotification } = make(undefined);

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(queueNotification).not.toHaveBeenCalled();
  });

  /**
   * 상대가 초대를 받자마자 수락하면, 신청자에게 duel:accepted가 요청 ack보다 먼저 도착할
   * 수 있었다 — 신청자 클라이언트는 아직 duelId를 모르는 채로 수락을 받고, 뒤늦은 ack가
   * 이미 열린 게임 위에 대기 화면을 다시 띄웠다.
   *
   * ack를 먼저 돌려주고 초대를 그 뒤로 미루면 이 순서가 뒤집힐 수 없다: 초대가 나가는
   * 것도, 상대의 수락이 신청자 소켓에 닿는 것도 전부 ack 뒤이기 때문이다.
   */
  it('요청 ack를 초대 전송보다 먼저 돌려준다', async () => {
    jest.useFakeTimers();
    const { gateway, client, socket, markInviteDelivered } = make({
      connected: true,
    });

    const ack = await gateway.handleDuelRequest(client, { targetUserId });

    // 핸들러가 반환하는 순간이 socket.io가 ack 패킷을 쓰는 순간이다.
    expect(ack).toEqual({ status: 'ok', ...pendingState });
    expect(socket!.emit).not.toHaveBeenCalled();
    expect(markInviteDelivered).not.toHaveBeenCalled();

    await flushInvite();
    expect(socket!.emit).toHaveBeenCalledWith(
      'duel:requested',
      expect.objectContaining({ duelId }),
    );
  });

  /**
   * 만료는 결투 생성 시점부터 30초다. 초대 전송이 ack 뒤로 밀렸으므로 타이머까지 함께
   * 밀리면 전송이 느린 만큼 만료가 늦게 발화한다 — 타이머는 핸들러가 반환하기 전에
   * 걸려 있어야 한다(startGameRound가 같은 이유로 emit보다 타이머를 먼저 건다).
   */
  it('만료 타이머를 ack 반환 전에 건다', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const { gateway, client } = make({ connected: true });

    await gateway.handleDuelRequest(client, { targetUserId });

    expect(
      setTimeoutSpy.mock.calls.some(
        ([, delay]) => delay === DUEL_REQUEST_TTL * 1000,
      ),
    ).toBe(true);
    setTimeoutSpy.mockRestore();
  });

  /**
   * 만료 타이머는 초대 전송보다 먼저 걸려 있다. 소켓 조회(Redis)가 30초 넘게 지연되면
   * 결투가 먼저 EXPIRED로 넘어가 duel:expired가 나가는데, 수신 클라이언트는 초대 전에 온
   * duel:expired를 duelId 불일치로 버린다 — 늦은 초대가 그대로 나가면 끝난 결투의 수락
   * 화면이 열린다.
   */
  it('소켓 조회가 만료보다 늦게 끝나면 초대를 보내지 않는다', async () => {
    jest.useFakeTimers();
    const {
      gateway,
      client,
      socket,
      findState,
      expireDuel,
      markInviteDelivered,
    } = make({ connected: true });
    let state = pendingState;
    findState.mockImplementation(() => Promise.resolve(state));
    expireDuel.mockImplementation(() => {
      state = { ...pendingState, state: DuelStatus.EXPIRED, revision: 1 };
      return Promise.resolve({
        id: duelId,
        opponentId: targetUserId,
        requestId: null,
        status: DuelStatus.EXPIRED,
        revision: 1,
        scoreDelta: null,
        shieldGranted: false,
      });
    });
    // 첫 조회(초대 전송)만 멈춰 두고, 만료 쪽 조회는 곧바로 응답한다.
    let releaseInviteLookup!: () => void;
    const meta = { team: 'JP', socketId: 'sock-opponent' };
    (gateway['redis'].getUserMeta as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseInviteLookup = () => resolve(meta);
          }),
      )
      .mockResolvedValue(meta);

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();
    await jest.advanceTimersByTimeAsync(DUEL_REQUEST_TTL * 1000);
    expect(socket!.emit).toHaveBeenCalledWith(
      'duel:expired',
      expect.objectContaining({
        duelId,
        state: DuelStatus.EXPIRED,
        revision: 1,
      }),
    );

    releaseInviteLookup();
    await jest.advanceTimersByTimeAsync(0);

    expect(socket!.emit).not.toHaveBeenCalledWith(
      'duel:requested',
      expect.anything(),
    );
    expect(markInviteDelivered).not.toHaveBeenCalled();
  });

  /** 스윕·탈퇴 정리 등 타이머 밖에서 끝난 결투도 같은 이유로 초대를 보내지 않는다. */
  it('PENDING이 아닌 결투에는 초대를 보내지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, socket, findState, markInviteDelivered } = make({
      connected: true,
    });
    findState.mockResolvedValue({
      ...pendingState,
      state: DuelStatus.EXPIRED,
      revision: 1,
    });

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(findState).toHaveBeenCalledWith(duelId);
    expect(socket!.emit).not.toHaveBeenCalled();
    expect(markInviteDelivered).not.toHaveBeenCalled();
  });

  /**
   * 상태 조회를 기다리는 사이 상대가 끊기면, 끊긴 소켓으로의 emit은 조용히 버려진다.
   * 그걸 전달로 기록하면 받지 못한 초대에 무응답이 청구된다.
   */
  it('상태 조회 중 상대가 끊기면 전달로 기록하지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, socket, findState, markInviteDelivered } = make({
      connected: true,
    });
    findState.mockImplementation(() => {
      socket!.connected = false;
      return Promise.resolve(pendingState);
    });

    await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(socket!.emit).not.toHaveBeenCalled();
    expect(markInviteDelivered).not.toHaveBeenCalled();
  });

  /**
   * 초대 전송은 이제 핸들러 밖(setImmediate)에서 돈다 — 예외가 새면 ack 에러가 아니라
   * unhandledRejection이 되어 소켓 하나의 실패가 프로세스 전체를 죽인다. 결투는 이미
   * 만들어졌고 만료 타이머도 걸려 있으므로, 여기서는 삼키고 로그만 남기는 것이 맞다.
   */
  it('초대 전송이 실패해도 ack는 정상이고 예외가 새지 않는다', async () => {
    jest.useFakeTimers();
    const { gateway, client, markInviteDelivered } = make({ connected: true });
    const errorSpy = jest
      .spyOn(gateway['logger'], 'error')
      .mockImplementation(() => undefined);
    (gateway['redis'].getUserMeta as jest.Mock).mockRejectedValue(
      new Error('redis down'),
    );

    const ack = await gateway.handleDuelRequest(client, { targetUserId });
    await flushInvite();

    expect(ack).toEqual({ status: 'ok', ...pendingState });
    expect(markInviteDelivered).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  /**
   * 같은 requestId의 재시도다. 첫 요청이 이미 만료 타이머와 초대를 걸었으므로 다시 걸면
   * 초대가 두 번 뜨고 만료 처리도 두 번 돈다. ack는 그 사이 바뀐 **현재** 상태를 싣는다.
   */
  it('재시도는 타이머·초대를 다시 걸지 않고 기존 결투의 현재 상태를 돌려준다', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const { gateway, client, socket, requestDuel, findState } = make({
      connected: true,
    });
    const requestId = '7d3f6a2e-1b4c-4d5e-8f90-a1b2c3d4e5f6';
    requestDuel.mockResolvedValue({
      duel: {
        id: duelId,
        challengerId: 'user-1',
        opponentId: targetUserId,
        requestId,
        status: DuelStatus.ACCEPTED,
        revision: 1,
      },
      created: false,
    });

    const ack = await gateway.handleDuelRequest(client, {
      targetUserId,
      requestId,
    });
    await flushInvite();

    expect(requestDuel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      targetUserId,
      requestId,
    );
    expect(ack).toEqual({
      status: 'ok',
      duelId,
      requestId,
      state: DuelStatus.ACCEPTED,
      revision: 1,
    });
    expect(
      setTimeoutSpy.mock.calls.some(
        ([, delay]) => delay === DUEL_REQUEST_TTL * 1000,
      ),
    ).toBe(false);
    expect(findState).not.toHaveBeenCalled();
    expect(socket!.emit).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  /** 복구 조회는 ack로만 답한다 — 이벤트로 재생하면 이미 반영한 클라이언트에 중복이 된다. */
  it('duel:sync는 호출자 기준 결투 상태를 ack로 돌려준다', async () => {
    const { gateway, client, socket, syncDuel } = make({ connected: true });
    const view = {
      ...pendingState,
      role: 'opponent',
      expiresAt: '2026-09-16T00:00:30.000Z',
      opponent: { id: 'user-2', nickname: 'you', team: 'JP' },
    };
    syncDuel.mockResolvedValue(view);

    const ack = await gateway.handleDuelSync(client, { duelId });

    expect(syncDuel).toHaveBeenCalledWith('user-1', { duelId });
    expect(ack).toEqual({ status: 'ok', duel: view });
    expect(socket!.emit).not.toHaveBeenCalled();
  });

  it('duel:sync는 결투가 없으면 duel: null이다', async () => {
    const { gateway, client } = make({ connected: true });

    await expect(gateway.handleDuelSync(client, {})).resolves.toEqual({
      status: 'ok',
      duel: null,
    });
  });
});

/**
 * 보호막이 걸린 유저에게는 requestDuel이 DUEL_TARGET_SHIELDED로 막는다. 조우 payload가
 * 그 사실을 싣지 않으면 클라이언트는 30분 내내 실패할 신청 버튼을 열어둔 채 왕복만 한다.
 */
describe('RealtimeGateway 조우 알림의 보호막 안내', () => {
  const me = { id: 'user-1', team: 'KR', nickname: '나' };
  const opponentId = 'user-2';

  function make(shieldTtlByUser: Record<string, number>) {
    const queueNotification = jest.fn().mockResolvedValue(undefined);
    const getDuelShieldTtl = jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(shieldTtlByUser[id] ?? 0),
      );
    const findByIds = jest
      .fn()
      .mockResolvedValue([{ id: opponentId, nickname: '상대' }]);
    const gateway = new RealtimeGateway(
      {} as unknown as FirebaseService,
      { findByIds } as unknown as UsersService,
      {
        geoAdd: jest.fn().mockResolvedValue(undefined),
        // 쿨다운을 처음 잡는 상황 = 새 조우로 알림이 나가는 경로.
        tryAcquireLock: jest.fn().mockResolvedValue(true),
        getDuelShieldTtl,
        // 상대 소켓을 못 찾게 두면 payload가 큐로 흘러 그대로 확인할 수 있다.
        getUserMeta: jest.fn().mockResolvedValue(null),
        queueNotification,
      } as unknown as RedisService,
      {
        setNotifier: jest.fn(),
        findNearbyOpponents: jest
          .fn()
          .mockResolvedValue([{ userId: opponentId, team: 'JP' }]),
      } as unknown as DuelsService,
      {} as never,
      { record: jest.fn() } as never,
      { register: jest.fn(), disconnectUser: jest.fn() } as never,
    );
    const client = { ...mockSocket(), data: { user: me } };
    return { gateway, client, queueNotification, getDuelShieldTtl, findByIds };
  }

  const update = (gateway: RealtimeGateway, client: unknown) =>
    gateway.handleLocationUpdate(client as never, {
      lat: 37.5,
      lng: 127,
    });

  interface EncounterPayload {
    userId: string;
    nickname: string | null;
    shieldUntil: string | null;
  }

  /** 내 화면으로 나간 조우 payload (client.emit(event, payload)). */
  const emitted = (client: MockSocket): EncounterPayload =>
    (client.emit.mock.calls as unknown[][]).find(
      (call) => call[0] === 'encounter:detected',
    )?.[1] as EncounterPayload;

  /** 상대에게 나간 조우 payload (queueNotification(userId, event, payload, ttl)). */
  const queued = (queueNotification: jest.Mock): EncounterPayload =>
    (queueNotification.mock.calls as unknown[][]).find(
      (call) => call[1] === 'encounter:detected',
    )?.[2] as EncounterPayload;

  it('보호 중인 상대의 조우에는 shieldUntil을 실어보낸다', async () => {
    const { gateway, client } = make({ [opponentId]: 600 });

    await update(gateway, client);

    const payload = emitted(client);
    expect(payload.userId).toBe(opponentId);
    // 남은 초가 아니라 절대 시각이어야 한다(duelPenaltyPayload와 같은 표현).
    expect(Date.parse(payload.shieldUntil as string)).toBeGreaterThan(
      Date.now(),
    );
  });

  // 상대에게 가는 payload의 주체는 나다 — 여기에 상대의 보호막을 실으면 "못 건다"의
  // 대상이 뒤바뀐다.
  it('상대에게 보내는 조우에는 내 보호막을 싣는다', async () => {
    const { gateway, client, queueNotification } = make({ [me.id]: 600 });

    await update(gateway, client);

    const toOpponent = queued(queueNotification);
    expect(toOpponent.userId).toBe(me.id);
    expect(Date.parse(toOpponent.shieldUntil as string)).toBeGreaterThan(
      Date.now(),
    );
    // 상대는 보호 중이 아니므로 내 화면의 신청 버튼은 열려 있어야 한다.
    expect(emitted(client).shieldUntil).toBeNull();
  });

  it('보호막이 없으면 null로 나간다', async () => {
    const { gateway, client } = make({});

    await update(gateway, client);

    expect(emitted(client).shieldUntil).toBeNull();
  });

  /**
   * 이 조회는 판정이 아니라 안내값이다(판정은 언제나 requestDuel이 Redis를 다시 읽는다).
   * 여기서 던지면 잃는 것은 보호막이 아니라 조우 자체다 — 핸들러는 이 조회 **전에** 이미
   * ENCOUNTER_COOLDOWN_TTL 락을 소모했으므로, 예외가 올라가면 양쪽 다 encounter:detected를
   * 못 받고 그 쌍은 쿨다운이 풀릴 때까지 조우가 다시 뜨지 않는다.
   */
  // 닉네임도 같은 성질이다 — 이 조회 전에 쿨다운 락이 이미 소모됐으므로, 던지면
  // 이름 하나 때문에 조우 이벤트 전체가 사라진다. payload는 nickname: null을 이미 허용한다.
  it('닉네임 조회가 실패해도 조우 알림은 나간다 (안내는 fail-open)', async () => {
    const { gateway, client, findByIds } = make({});
    findByIds.mockRejectedValue(new Error('db down'));

    await expect(update(gateway, client)).resolves.toEqual({ status: 'ok' });

    const payload = emitted(client);
    expect(payload.userId).toBe(opponentId);
    expect(payload.nickname).toBeNull();
  });

  it('보호막 조회가 실패해도 조우 알림은 나간다 (안내는 fail-open)', async () => {
    const { gateway, client, queueNotification, getDuelShieldTtl } = make({
      [opponentId]: 600,
    });
    getDuelShieldTtl.mockRejectedValue(new Error('redis down'));

    await expect(update(gateway, client)).resolves.toEqual({ status: 'ok' });

    // 조우는 양쪽에 그대로 나가고, 안내값만 "보호막 없음"으로 넘어진다.
    expect(emitted(client).userId).toBe(opponentId);
    expect(emitted(client).shieldUntil).toBeNull();
    expect(queued(queueNotification).shieldUntil).toBeNull();
  });
});
