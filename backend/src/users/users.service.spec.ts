import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { FirebaseService } from '../common/firebase/firebase.service';
import { RedisService } from '../common/redis/redis.service';

/**
 * 계정 삭제(탈퇴) — 앱스토어·플레이스토어 필수 요건.
 *
 * 무엇을 지우고 무엇을 남기는지가 이 기능의 전부라, 그 경계를 고정한다.
 */
describe('UsersService.deleteAccount', () => {
  const user = {
    id: 'user-1',
    firebaseUid: 'fuid-1',
    email: 'a@b.com',
  } as User;

  function make() {
    const userRepository = { delete: jest.fn().mockResolvedValue({}) };
    const firebaseService = {
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    const redis = { purgeUserKeys: jest.fn().mockResolvedValue(undefined) };
    const service = new UsersService(
      userRepository as never,
      firebaseService as unknown as FirebaseService,
      redis as unknown as RedisService,
    );
    return { service, userRepository, firebaseService, redis };
  }

  it('users 행과 Firebase 계정, Redis 키를 모두 지운다', async () => {
    const { service, userRepository, firebaseService, redis } = make();

    await service.deleteAccount(user);

    expect(userRepository.delete).toHaveBeenCalledWith({ id: 'user-1' });
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
    const { service, userRepository, firebaseService } = make();
    userRepository.delete.mockRejectedValue(new Error('db down'));

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
});
