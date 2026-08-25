import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ReportReason } from './entities/report.entity';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { ErrorCode } from '../common/errors/error-code';

/**
 * 신고·차단 — Apple 심사 가이드라인 1.2(UGC) 대응.
 */
describe('ModerationService', () => {
  function make() {
    const insertBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    const blockRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(() => insertBuilder),
    };
    const reportRepo = { save: jest.fn().mockResolvedValue({ id: 7 }) };
    const usersService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'target-1', nickname: '대상' }),
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn().mockResolvedValue(1),
      consumeRateLimit: jest.fn().mockResolvedValue(true),
    };
    const service = new ModerationService(
      blockRepo as never,
      reportRepo as never,
      usersService as unknown as UsersService,
      redis as unknown as RedisService,
    );
    return {
      service,
      blockRepo,
      reportRepo,
      usersService,
      redis,
      insertBuilder,
    };
  }

  describe('block', () => {
    it('자기 자신은 차단할 수 없다', async () => {
      const { service } = make();
      const err = await service.block('u1', 'u1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: ErrorCode.BLOCK_SELF,
      });
    });

    it('없는 유저는 404', async () => {
      const { service, usersService } = make();
      usersService.findById.mockResolvedValue(null);
      await expect(service.block('u1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // 재시도·중복 탭에서 409를 받을 이유가 없다.
    it('중복 차단은 orIgnore로 멱등 처리한다', async () => {
      const { service, insertBuilder } = make();
      await service.block('u1', 'target-1');
      expect(insertBuilder.orIgnore).toHaveBeenCalled();
    });

    // 캐시가 남아 있으면 차단 직후에도 메시지가 계속 전달된다.
    it('차단 시 대상의 blockedBy 캐시를 즉시 무효화한다', async () => {
      const { service, redis } = make();
      await service.block('u1', 'target-1');
      expect(redis.incr).toHaveBeenCalledWith('chat:blockedbyver:target-1');
      expect(redis.del).toHaveBeenCalledWith('chat:blockedby:target-1');
    });

    it('해제 시에도 캐시를 무효화한다', async () => {
      const { service, redis } = make();
      await service.unblock('u1', 'target-1');
      expect(redis.del).toHaveBeenCalledWith('chat:blockedby:target-1');
    });
  });

  describe('getBlockedBy', () => {
    it('캐시 히트면 DB를 치지 않는다', async () => {
      const { service, blockRepo, redis } = make();
      redis.get.mockResolvedValue('a,b');

      await expect(service.getBlockedBy('t1')).resolves.toEqual(['a', 'b']);
      expect(blockRepo.find).not.toHaveBeenCalled();
    });

    // 빈 문자열은 "차단한 사람 없음"을 캐시한 것이지 미스가 아니다.
    it('빈 문자열 캐시는 빈 배열로 해석한다', async () => {
      const { service, blockRepo, redis } = make();
      redis.get.mockResolvedValue('');

      await expect(service.getBlockedBy('t1')).resolves.toEqual([]);
      expect(blockRepo.find).not.toHaveBeenCalled();
    });

    // 회귀 가드: DB를 읽는 동안 차단이 끼어들면, 낡은 결과를 캐시하면 안 된다.
    // 캐시하면 그 차단이 TTL(5분)만큼 무시된다.
    it('읽는 도중 버전이 바뀌면 낡은 결과를 캐시하지 않는다', async () => {
      const { service, blockRepo, redis } = make();
      redis.get
        .mockResolvedValueOnce(null) // 캐시 미스
        .mockResolvedValueOnce('1') // 읽기 전 버전
        .mockResolvedValueOnce('2'); // 읽기 후 버전 — 그 사이 차단이 발생
      blockRepo.find.mockResolvedValue([]);

      await expect(service.getBlockedBy('t1')).resolves.toEqual([]);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('버전이 그대로면 결과를 캐시한다', async () => {
      const { service, blockRepo, redis } = make();
      redis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('1');
      blockRepo.find.mockResolvedValue([{ blockerId: 'a' }]);

      await expect(service.getBlockedBy('t1')).resolves.toEqual(['a']);
      expect(redis.set).toHaveBeenCalledWith('chat:blockedby:t1', 'a', 300);
    });

    // 캐시는 가속 장치일 뿐 — 여기서 throw하면 Redis 장애 시 채팅이 통째로 멈춘다.
    it('Redis 장애는 미스로 흡수하고 DB로 조회한다', async () => {
      const { service, blockRepo, redis } = make();
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockRejectedValue(new Error('redis down'));
      blockRepo.find.mockResolvedValue([{ blockerId: 'a' }]);

      await expect(service.getBlockedBy('t1')).resolves.toEqual(['a']);
    });
  });

  describe('report', () => {
    const dto = {
      targetUserId: 'target-1',
      reason: ReportReason.ABUSE,
      contentSnapshot: '욕설 메시지',
    };

    it('자기 자신은 신고할 수 없다', async () => {
      const { service } = make();
      const err = await service
        .report('target-1', dto)
        .catch((e: unknown) => e);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: ErrorCode.REPORT_SELF,
      });
    });

    // 채팅은 저장되지 않으므로 스냅샷이 유일한 증거다.
    it('메시지 스냅샷과 대상 닉네임을 함께 저장한다', async () => {
      const { service, reportRepo } = make();

      await expect(service.report('u1', dto)).resolves.toEqual({ id: 7 });
      expect(reportRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          reporterId: 'u1',
          targetUserId: 'target-1',
          targetNickname: '대상',
          contentSnapshot: '욕설 메시지',
        }),
      );
    });

    it('신고 도배는 레이트리밋으로 막는다', async () => {
      const { service, redis, reportRepo } = make();
      redis.consumeRateLimit.mockResolvedValue(false);

      const err = await service.report('u1', dto).catch((e: unknown) => e);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: ErrorCode.REPORT_RATE_LIMIT,
      });
      expect(reportRepo.save).not.toHaveBeenCalled();
    });
  });
});
