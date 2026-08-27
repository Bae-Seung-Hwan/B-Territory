import { RealtimeGateway } from './realtime.gateway';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { DuelsService } from '../duels/duels.service';
import {
  GAME_EXPIRE_MAX_ATTEMPTS,
  GAME_EXPIRE_RETRY_MS,
} from '../duels/minigame/constants';

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
