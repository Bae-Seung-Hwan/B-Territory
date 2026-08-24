import { RealtimeGateway } from './realtime.gateway';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { DuelsService } from '../duels/duels.service';

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
