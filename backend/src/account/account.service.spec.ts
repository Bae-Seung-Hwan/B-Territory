import { AccountService } from './account.service';
import { User } from '../users/entities/user.entity';
import { FirebaseService } from '../common/firebase/firebase.service';
import { RedisService } from '../common/redis/redis.service';
import { DuelsService } from '../duels/duels.service';
import { HallOfFameService } from '../hall-of-fame/hall-of-fame.service';
import { WsSessionsService } from '../common/ws/ws-sessions.service';

/**
 * 계정 삭제(탈퇴) — 앱스토어·플레이스토어 필수 요건.
 *
 * 무엇을 지우고 무엇을 남기는지, 그리고 어떤 순서로 하는지가 이 기능의 전부라
 * 그 경계를 고정한다.
 */
describe('AccountService.deleteAccount', () => {
  const user = {
    id: 'user-1',
    firebaseUid: 'fuid-1',
    email: 'a@b.com',
  } as User;

  function make() {
    // 트랜잭션 콜백을 그대로 실행해, 결투 종료와 users 삭제가 같은 manager로 도는
    // 순서를 실제와 같이 재현한다.
    const manager = { delete: jest.fn().mockResolvedValue({}) };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };
    const firebaseService = {
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    const redis = { purgeUserKeys: jest.fn().mockResolvedValue(undefined) };
    const duelsService = {
      terminateActiveDuelsFor: jest.fn().mockResolvedValue([]),
      settleTerminatedDuels: jest.fn().mockResolvedValue(undefined),
    };
    const hallOfFame = {
      invalidateUserRanking: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = { register: jest.fn(), disconnectUser: jest.fn() };
    const service = new AccountService(
      dataSource as never,
      firebaseService as unknown as FirebaseService,
      redis as unknown as RedisService,
      duelsService as unknown as DuelsService,
      hallOfFame as unknown as HallOfFameService,
      sessions as unknown as WsSessionsService,
    );
    return {
      service,
      dataSource,
      manager,
      firebaseService,
      redis,
      duelsService,
      hallOfFame,
      sessions,
    };
  }

  it('users 행과 Firebase 계정, Redis 키를 모두 지운다', async () => {
    const { service, manager, firebaseService, redis } = make();

    await service.deleteAccount(user);

    expect(manager.delete).toHaveBeenCalledWith(User, { id: 'user-1' });
    expect(firebaseService.deleteUser).toHaveBeenCalledWith('fuid-1');
    expect(redis.purgeUserKeys).toHaveBeenCalledWith('user-1');
  });

  // Firebase 계정을 남기면 같은 이메일로 영구 재가입 불가가 된다.
  it('Firebase 삭제가 실패하면 탈퇴를 실패로 전파한다', async () => {
    const { service, firebaseService } = make();
    firebaseService.deleteUser.mockRejectedValue(new Error('firebase down'));

    await expect(service.deleteAccount(user)).rejects.toThrow('firebase down');
  });

  // DB 삭제를 먼저 커밋해야, 실패 시 "로그인은 되는데 계정이 없는" 상태가 생기지 않는다.
  it('DB 삭제가 실패하면 Firebase 계정은 건드리지 않는다', async () => {
    const { service, manager, firebaseService } = make();
    manager.delete.mockRejectedValue(new Error('db down'));

    await expect(service.deleteAccount(user)).rejects.toThrow('db down');
    expect(firebaseService.deleteUser).not.toHaveBeenCalled();
  });

  // 계정은 이미 사라졌고 남은 키는 전부 TTL로 소멸한다 — 여기서 실패로 만들면
  // 유저는 "탈퇴 실패"를 보지만 계정은 이미 없는 모순된 상태가 된다.
  it('Redis 정리가 실패해도 탈퇴는 성공으로 끝난다', async () => {
    const { service, redis } = make();
    redis.purgeUserKeys.mockRejectedValue(new Error('redis down'));

    await expect(service.deleteAccount(user)).resolves.toBeUndefined();
  });

  /**
   * 진행 중인 결투를 남긴 채 유저를 지우면 FK가 SET NULL이라 삭제는 성공하지만,
   * 참가자 한쪽이 NULL인 활성 행이 남아 상대가 새 결투를 신청하지 못한다.
   */
  it('결투 종료를 users 행 삭제와 같은 트랜잭션에서, 삭제보다 먼저 한다', async () => {
    const { service, dataSource, manager, duelsService } = make();
    const order: string[] = [];
    duelsService.terminateActiveDuelsFor.mockImplementation(() => {
      order.push('terminate');
      return Promise.resolve([]);
    });
    manager.delete.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({});
    });

    await service.deleteAccount(user);

    expect(order).toEqual(['terminate', 'delete']);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(duelsService.terminateActiveDuelsFor).toHaveBeenCalledWith(
      'user-1',
      manager,
    );
  });

  // 롤백된 트랜잭션의 결투를 상대에게 종료됐다고 알리거나 락을 풀어버리면 안 된다.
  it('결투 뒷정리(락 해제·알림)는 커밋 뒤에만 한다', async () => {
    const { service, manager, duelsService } = make();
    duelsService.terminateActiveDuelsFor.mockResolvedValue([
      { id: 7, challengerId: 'user-1', opponentId: 'user-2' },
    ]);
    manager.delete.mockRejectedValue(new Error('db down'));

    await expect(service.deleteAccount(user)).rejects.toThrow('db down');
    expect(duelsService.settleTerminatedDuels).not.toHaveBeenCalled();
  });

  it('커밋에 성공하면 종료된 결투를 탈퇴자를 빼고 뒷정리한다', async () => {
    const { service, duelsService } = make();
    const rows = [{ id: 7, challengerId: 'user-1', opponentId: 'user-2' }];
    duelsService.terminateActiveDuelsFor.mockResolvedValue(rows);

    await service.deleteAccount(user);

    expect(duelsService.settleTerminatedDuels).toHaveBeenCalledWith(
      rows,
      'user-1',
    );
  });

  /**
   * 인증은 핸드셰이크에서 한 번만 하고 client.data에 캐시된다. 끊지 않으면 탈퇴 후에도
   * 그 소켓이 살아 있어, location:update 한 번이면 방금 지운 geo 키가 되살아나고
   * 탈퇴자가 다시 결투 탐지에 잡힌다.
   */
  it('열려 있는 소켓 세션을 끊고, 그 뒤에 Redis를 정리한다', async () => {
    const { service, redis, sessions } = make();
    const order: string[] = [];
    sessions.disconnectUser.mockImplementation(() => order.push('disconnect'));
    redis.purgeUserKeys.mockImplementation(() => {
      order.push('purge');
      return Promise.resolve();
    });

    await service.deleteAccount(user);

    expect(sessions.disconnectUser).toHaveBeenCalledWith('user-1');
    // 순서가 뒤집히면 살아 있는 소켓이 정리된 키를 다시 만든다.
    expect(order).toEqual(['disconnect', 'purge']);
  });

  /**
   * 개인 랭킹 캐시에는 닉네임이 박혀 있고 끝난 시즌은 TTL이 24시간이다. 지우지 않으면
   * "탈퇴 즉시 노출되지 않는다"는 API.md·compliance.md의 약속이 하루 동안 깨진다.
   */
  it('개인 랭킹 캐시를 무효화한다', async () => {
    const { service, hallOfFame } = make();

    await service.deleteAccount(user);

    expect(hallOfFame.invalidateUserRanking).toHaveBeenCalled();
  });

  /**
   * Firebase 삭제는 외부 HTTPS 왕복이라 수백 ms가 걸린다. 그 전에 geo·meta를 지워야
   * 남은 유저에게 탈퇴자가 "접속 중"으로 보여 결투 신청이 들어오는 창이 닫힌다
   * (그 신청은 이미 사라진 유저를 참조해 FK 위반으로 터진다).
   */
  it('Redis 정리를 Firebase 삭제보다 먼저 한다', async () => {
    const { service, redis, firebaseService } = make();
    const order: string[] = [];
    redis.purgeUserKeys.mockImplementation(() => {
      order.push('purge');
      return Promise.resolve();
    });
    firebaseService.deleteUser.mockImplementation(() => {
      order.push('firebase');
      return Promise.resolve();
    });

    await service.deleteAccount(user);

    expect(order).toEqual(['purge', 'firebase']);
  });
});

/**
 * DB 삭제 커밋 직후 크래시하면 Firebase 계정만 남는다. 이 경로가 없으면 재시도해도
 * 프로필이 없어 404로 막혀, 그 이메일로 영구 재가입이 불가능해진다.
 */
describe('AccountService.deleteOrphanedAuth', () => {
  it('DB 프로필 없이 Firebase 계정만 지운다', async () => {
    const firebaseService = {
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AccountService(
      {} as never,
      firebaseService as unknown as FirebaseService,
      {} as unknown as RedisService,
      {} as unknown as DuelsService,
      {} as unknown as HallOfFameService,
      {} as unknown as WsSessionsService,
    );

    await expect(service.deleteOrphanedAuth('fuid-1')).resolves.toBeUndefined();
    expect(firebaseService.deleteUser).toHaveBeenCalledWith('fuid-1');
  });
});
