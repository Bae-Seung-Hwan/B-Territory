import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DuelsService } from './duels.service';
import { Duel, DuelStatus } from './entities/duel.entity';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { BASE_DUEL_SCORE, ALLY_BONUS_MULTIPLIER } from './constants';

const createQueryBuilderMock = (affected: number) => ({
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected }),
});

describe('DuelsService', () => {
  let service: DuelsService;
  let duelRepo: jest.Mocked<Repository<Duel>>;
  let dataSource: { query: jest.Mock };
  let redis: jest.Mocked<
    Pick<
      RedisService,
      | 'hasPenalty'
      | 'setPenalty'
      | 'tryAcquireLock'
      | 'releaseLock'
      | 'extendLock'
      | 'geoPos'
      | 'geoPosMany'
      | 'geoSearch'
      | 'getUserMeta'
      | 'submitDuelResult'
    >
  >;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findById' | 'applyScoreDelta'>
  >;

  const challenger = { id: 'user-a', team: 'KR' };
  const opponentId = 'user-b';

  beforeEach(async () => {
    duelRepo = {
      findOne: jest.fn(),
      create: jest.fn((data: Partial<Duel>) => data as Duel),
      save: jest.fn((duel: Duel) => Promise.resolve({ id: 1, ...duel })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock(1)),
    } as unknown as jest.Mocked<Repository<Duel>>;

    dataSource = {
      query: jest.fn().mockResolvedValue([{ id: opponentId, within: true }]),
    };

    redis = {
      hasPenalty: jest.fn().mockResolvedValue(false),
      setPenalty: jest.fn().mockResolvedValue(undefined),
      tryAcquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      extendLock: jest.fn().mockResolvedValue(true),
      geoPos: jest.fn().mockResolvedValue({ lat: 35.1, lng: 129.05 }),
      geoPosMany: jest.fn().mockResolvedValue(new Map()),
      geoSearch: jest.fn().mockResolvedValue([]),
      getUserMeta: jest
        .fn()
        .mockResolvedValue({ team: 'JP', socketId: 'socket-1' }),
      submitDuelResult: jest.fn(),
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({ id: opponentId, team: 'JP' }),
      applyScoreDelta: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuelsService,
        { provide: getRepositoryToken(Duel), useValue: duelRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(DuelsService);
  });

  describe('requestDuel', () => {
    it('같은 팀에게는 결투를 신청할 수 없다', async () => {
      usersService.findById.mockResolvedValue({
        id: opponentId,
        team: challenger.team,
      } as never);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('페널티 중인 상대에게는 결투를 신청할 수 없다', async () => {
      redis.hasPenalty.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('상대의 메타(접속 상태)가 없으면 신청할 수 없다 (오프라인/유령 좌표 방지)', async () => {
      redis.getUserMeta.mockResolvedValueOnce(null);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('100m 밖이면 결투를 신청할 수 없다', async () => {
      dataSource.query.mockResolvedValue([{ id: opponentId, within: false }]);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('이미 진행 중인 요청이 있으면 거부하고 방금 만든 row를 삭제한다', async () => {
      redis.tryAcquireLock.mockResolvedValue(false);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        ConflictException,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- overloaded Repository.delete confuses the rule on a jest mock
      expect(duelRepo.delete).toHaveBeenCalledWith(1);
    });

    it('정상 조건이면 PENDING 결투를 생성하고 결투 id를 락 토큰으로 사용한다', async () => {
      const duel = await service.requestDuel(challenger, opponentId);

      expect(duel.status).toBe(DuelStatus.PENDING);
      expect(duel.challengerId).toBe(challenger.id);
      expect(duel.opponentId).toBe(opponentId);
      expect(redis.tryAcquireLock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        String(duel.id),
      );
    });
  });

  describe('respondDuel', () => {
    const buildPendingDuel = (): Duel =>
      ({
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.PENDING,
      }) as Duel;

    it('이미 처리된 결투에 대한 응답은 경쟁 상태에서 거부한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      await expect(service.respondDuel(1, opponentId, true)).rejects.toThrow(
        ConflictException,
      );
    });

    it('수락 시 락을 DUEL_ACTIVE_TTL로 연장한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());

      const duel = await service.respondDuel(1, opponentId, true);

      expect(duel.status).toBe(DuelStatus.ACCEPTED);
      expect(redis.extendLock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        '1',
      );
      expect(redis.releaseLock).not.toHaveBeenCalled();
    });

    it('거절 시 락을 해제한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());

      const duel = await service.respondDuel(1, opponentId, false);

      expect(duel.status).toBe(DuelStatus.REJECTED);
      expect(redis.releaseLock).toHaveBeenCalledWith(expect.any(String), '1');
    });
  });

  describe('submitResult / 아군 보너스', () => {
    const buildAcceptedDuel = (): Duel =>
      ({
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.ACCEPTED,
      }) as Duel;

    it('신고가 하나뿐이면 waiting 상태를 반환한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({ status: 'waiting' });

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('waiting');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });

    it('신고가 엇갈리면 VOID 처리하고 락을 해제한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({ status: 'conflict' });

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('conflict');
      if (outcome.status === 'conflict') {
        expect(outcome.duel.status).toBe(DuelStatus.VOID);
      }
      expect(redis.releaseLock).toHaveBeenCalledWith(expect.any(String), '1');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });

    it('합의된 승자에게 기본 점수를 적용하고 패자에게 30분 페널티를 건다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      // 아군 보너스 조건 미충족: 주변에 같은 팀 후보가 없음
      redis.geoSearch.mockResolvedValue([]);

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('confirmed');
      if (outcome.status === 'confirmed') {
        expect(outcome.duel.winnerId).toBe(challenger.id);
        expect(outcome.duel.loserId).toBe(opponentId);
        expect(outcome.duel.scoreDelta).toBe(BASE_DUEL_SCORE);
        expect(outcome.duel.allyBonusApplied).toBe(false);
      }
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        challenger.id,
        BASE_DUEL_SCORE,
      );
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -BASE_DUEL_SCORE,
      );
      expect(redis.setPenalty).toHaveBeenCalledWith(
        opponentId,
        expect.any(Number),
      );
    });

    it('승자 주변에 아군이 2명 이상이면 1.5배 점수를 적용한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });

      // 승자(challenger) 팀 = KR, 주변 후보 2명 모두 같은 팀
      redis.getUserMeta.mockImplementation((id: string) =>
        Promise.resolve(
          id === challenger.id
            ? { team: 'KR', socketId: 's0' }
            : { team: 'KR', socketId: `s-${id}` },
        ),
      );
      redis.geoSearch.mockResolvedValue(['ally-1', 'ally-2']);
      redis.geoPosMany.mockResolvedValue(
        new Map([
          ['ally-1', { lat: 35.1001, lng: 129.0501 }],
          ['ally-2', { lat: 35.1002, lng: 129.0502 }],
        ]),
      );
      dataSource.query.mockResolvedValue([
        { id: 'ally-1', within: true },
        { id: 'ally-2', within: true },
      ]);

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      const expectedDelta = Math.round(BASE_DUEL_SCORE * ALLY_BONUS_MULTIPLIER);
      expect(outcome.status).toBe('confirmed');
      if (outcome.status === 'confirmed') {
        expect(outcome.duel.allyBonusApplied).toBe(true);
        expect(outcome.duel.scoreDelta).toBe(expectedDelta);
      }
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        challenger.id,
        expectedDelta,
      );
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -expectedDelta,
      );
    });

    it('이미 COMPLETED로 처리된 결투는 재시도해도 점수를 다시 반영하지 않는다', async () => {
      const alreadyCompleted = {
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.COMPLETED,
        winnerId: challenger.id,
        loserId: opponentId,
        scoreDelta: BASE_DUEL_SCORE,
        allyBonusApplied: false,
      } as Duel;

      duelRepo.findOne
        .mockResolvedValueOnce(buildAcceptedDuel()) // submitResult의 초기 조회
        .mockResolvedValueOnce(alreadyCompleted); // resolveDuel CAS 실패 후 재조회
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      // 다른 요청이 이미 ACCEPTED -> COMPLETED 전환을 선점 (CAS 실패)
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('confirmed');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setPenalty).not.toHaveBeenCalled();
    });
  });
});
