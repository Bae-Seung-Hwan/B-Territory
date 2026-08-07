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
import { ScoresService } from '../scores/scores.service';
import { ScoreEventType } from '../scores/entities/score-event.entity';
import {
  BASE_DUEL_SCORE,
  ALLY_BONUS_MULTIPLIER,
  DUEL_RESULT_TTL,
  DUEL_SWEEP_GRACE,
} from './constants';

const createQueryBuilderMock = (affected: number, raw: unknown[] = []) => ({
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected, raw }),
});

describe('DuelsService', () => {
  let service: DuelsService;
  let duelRepo: jest.Mocked<Repository<Duel>>;
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let txManager: {
    query: jest.Mock;
    exists: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let redis: jest.Mocked<
    Pick<
      RedisService,
      | 'hasPenalty'
      | 'setPenalty'
      | 'clearPenalty'
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
    Pick<UsersService, 'findById' | 'findByIds' | 'applyScoreDelta'>
  >;
  let scoresService: jest.Mocked<Pick<ScoresService, 'record'>>;

  const challenger = { id: 'user-a', team: 'KR' };
  const opponentId = 'user-b';

  beforeEach(async () => {
    duelRepo = {
      findOne: jest.fn(),
      save: jest.fn((duel: Duel) =>
        Promise.resolve({ ...duel, id: duel.id ?? 1 }),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock(1)),
    } as unknown as jest.Mocked<Repository<Duel>>;

    txManager = {
      query: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((_entity: unknown, data: Partial<Duel>) => data as Duel),
      save: jest.fn((duel: Duel) =>
        Promise.resolve({ ...duel, id: duel.id ?? 1 }),
      ),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock(1)),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([{ id: opponentId, within: true }]),
      transaction: jest.fn((cb: (manager: unknown) => unknown) =>
        Promise.resolve(cb(txManager)),
      ),
    };

    redis = {
      hasPenalty: jest.fn().mockResolvedValue(false),
      setPenalty: jest.fn().mockResolvedValue({ created: true }),
      clearPenalty: jest.fn().mockResolvedValue(undefined),
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
      // 원장에 남길 이벤트 시점 팀 조회 — 승자/패자 두 유저를 한 번에 읽는다.
      findByIds: jest.fn().mockResolvedValue([
        { id: challenger.id, team: challenger.team },
        { id: opponentId, team: 'JP' },
      ]),
      applyScoreDelta: jest.fn().mockResolvedValue(undefined),
    };

    scoresService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuelsService,
        { provide: getRepositoryToken(Duel), useValue: duelRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
        { provide: UsersService, useValue: usersService },
        { provide: ScoresService, useValue: scoresService },
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

    it('참가자 중 누군가 이미 진행 중인 결투가 있으면 신청할 수 없다', async () => {
      txManager.exists.mockResolvedValue(true);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        ConflictException,
      );
      expect(txManager.save).not.toHaveBeenCalled();
    });

    it('배타성 확인 전에 참가자별 advisory lock을 id 정렬 순서로 획득한다 (TOCTOU 차단)', async () => {
      await service.requestDuel(challenger, opponentId);

      const queryCalls = txManager.query.mock.calls as [string, string[]][];
      const lockKeys = queryCalls.map(([, params]) => params[0]);
      expect(lockKeys).toEqual(['duel:user:user-a', 'duel:user:user-b']);
      expect(queryCalls[0][0]).toContain('pg_advisory_xact_lock');
      // 락 획득이 존재 확인보다 먼저 실행되어야 확인~저장 창이 직렬화된다
      expect(txManager.query.mock.invocationCallOrder[1]).toBeLessThan(
        txManager.exists.mock.invocationCallOrder[0],
      );
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
      // 점수 반영은 상태 확정 CAS와 같은 트랜잭션(manager)에서 실행되어야 한다
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        challenger.id,
        BASE_DUEL_SCORE,
        txManager,
      );
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -BASE_DUEL_SCORE,
        txManager,
      );
      expect(redis.setPenalty).toHaveBeenCalledWith(
        opponentId,
        expect.any(Number),
      );
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('승패를 점수 원장에 append한다 — 팀 점수는 0, 같은 트랜잭션', async () => {
      // 개인 랭킹은 users.score가 아니라 SUM(score_events.personalPoints)로 산출되므로,
      // 원장에 남지 않으면 결투 점수가 /users/me와 명예의 전당에서 서로 다른 값이 된다.
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      redis.geoSearch.mockResolvedValue([]);

      await service.submitResult(1, challenger.id, challenger.id);

      expect(scoresService.record).toHaveBeenCalledWith(txManager, {
        userId: challenger.id,
        team: challenger.team,
        type: ScoreEventType.DUEL_WIN,
        personalPoints: BASE_DUEL_SCORE,
        teamPoints: 0,
        duelId: 1,
      });
      expect(scoresService.record).toHaveBeenCalledWith(txManager, {
        userId: opponentId,
        team: 'JP',
        type: ScoreEventType.DUEL_LOSS,
        personalPoints: -BASE_DUEL_SCORE,
        teamPoints: 0,
        duelId: 1,
      });
    });

    it('탈퇴로 유저 row가 사라진 참가자는 원장 행을 남기지 않는다', async () => {
      // applyScoreDelta도 대상 row가 없어 no-op이므로, 원장에만 유령 행이 남는 일이 없어야 한다.
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      redis.geoSearch.mockResolvedValue([]);
      usersService.findByIds.mockResolvedValue([
        { id: challenger.id, team: challenger.team },
      ] as never);

      await service.submitResult(1, challenger.id, challenger.id);

      expect(scoresService.record).toHaveBeenCalledTimes(1);
      expect(scoresService.record).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({ userId: challenger.id }),
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
        txManager,
      );
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -expectedDelta,
        txManager,
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
      // 신고 스탬프는 성공(duelRepo QB 기본값), 다른 요청이 이미
      // ACCEPTED -> COMPLETED 전환을 선점해 트랜잭션 내 CAS가 실패 (affected=0)
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('confirmed');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      // 선점한 처리가 COMPLETED를 커밋했으므로 패자 페널티는 정당 — 되돌리지 않는다
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('정리 잡이 먼저 VOID 처리한 결투는 confirmed 대신 conflict로 반환한다', async () => {
      const sweptVoid = {
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.VOID,
        winnerId: null,
      } as Duel;

      duelRepo.findOne
        .mockResolvedValueOnce(buildAcceptedDuel()) // submitResult의 초기 조회
        .mockResolvedValueOnce(sweptVoid); // resolveDuel CAS 실패 후 재조회
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      // 신고 스탬프는 성공(duelRepo QB 기본값), 스윕이 이미
      // ACCEPTED -> VOID 전환을 선점해 트랜잭션 내 CAS가 실패 (affected=0)
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const outcome = await service.submitResult(
        1,
        challenger.id,
        challenger.id,
      );

      expect(outcome.status).toBe('conflict');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      // VOID로 끝났으니 승패 미확정 — 이번 호출이 새로 만든 페널티는 되돌린다
      expect(redis.clearPenalty).toHaveBeenCalledWith(opponentId);
    });

    it('신고 접수 스탬프(CAS)가 실패하면(스윕이 이미 VOID 커밋) Redis에 신고를 기록하지 않고 거부한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      // findOne 이후 스윕이 ACCEPTED -> VOID를 커밋해 스탬프 UPDATE가 affected=0
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      await expect(
        service.submitResult(1, challenger.id, challenger.id),
      ).rejects.toThrow(ConflictException);
      expect(redis.submitDuelResult).not.toHaveBeenCalled();
    });

    it('점수 반영이 실패하면 상태 확정도 함께 롤백되고, 새로 만든 페널티를 되돌린다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      redis.geoSearch.mockResolvedValue([]);
      usersService.applyScoreDelta.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        service.submitResult(1, challenger.id, challenger.id),
      ).rejects.toThrow('DB connection lost');

      // CAS와 점수 반영이 같은 트랜잭션이므로 에러 전파 = 전체 롤백(결투는 ACCEPTED 유지,
      // 신고 스탬프가 신선해 스윕도 유예됨) — 재시도가 가능한 상태로 남아야 한다
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(redis.clearPenalty).toHaveBeenCalledWith(opponentId);
    });

    it('트랜잭션 실패 시 기존에 있던 페널티(created=false)는 건드리지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      redis.geoSearch.mockResolvedValue([]);
      redis.setPenalty.mockResolvedValue({ created: false });
      usersService.applyScoreDelta.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        service.submitResult(1, challenger.id, challenger.id),
      ).rejects.toThrow('DB connection lost');
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('아군 보너스 판정(Redis)이 실패하면 상태 커밋·페널티 전에 중단되어 재시도 가능하다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.submitDuelResult.mockResolvedValue({
        status: 'confirmed',
        winnerId: challenger.id,
      });
      redis.geoPos.mockRejectedValue(new Error('Redis down'));

      await expect(
        service.submitResult(1, challenger.id, challenger.id),
      ).rejects.toThrow('Redis down');

      // 아직 아무것도 커밋되지 않았어야 한다 (결투는 ACCEPTED 유지 → 재시도로 복구)
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(redis.setPenalty).not.toHaveBeenCalled();
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });
  });

  describe('sweepStaleDuels', () => {
    it('오래된 PENDING은 EXPIRED로, 오래된 ACCEPTED는 VOID로 전이하고 건수를 반환한다', async () => {
      const pendingQb = createQueryBuilderMock(2);
      const acceptedQb = createQueryBuilderMock(3);
      (duelRepo.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(pendingQb)
        .mockReturnValueOnce(acceptedQb);

      const result = await service.sweepStaleDuels();

      expect(result).toEqual({ expiredPending: 2, voidedAccepted: 3 });
      expect(pendingQb.set).toHaveBeenCalledWith({
        status: DuelStatus.EXPIRED,
      });
      expect(pendingQb.where).toHaveBeenCalledWith(
        expect.stringContaining('requestedAt'),
        expect.objectContaining({ pending: DuelStatus.PENDING }),
      );
      expect(acceptedQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: DuelStatus.VOID }),
      );
      expect(acceptedQb.where).toHaveBeenCalledWith(
        expect.stringContaining('respondedAt'),
        expect.objectContaining({ accepted: DuelStatus.ACCEPTED }),
      );
      // 결과 신고가 진행 중인 결투(resultReportedAt 신선)는 VOID 컷오프에서 제외되어야 한다
      expect(acceptedQb.where).toHaveBeenCalledWith(
        expect.stringContaining('"resultReportedAt" IS NULL OR'),
        expect.objectContaining({
          resultSec: DUEL_RESULT_TTL + DUEL_SWEEP_GRACE,
        }),
      );
    });

    it('방치된 결투가 없으면 0건을 반환한다', async () => {
      (duelRepo.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(createQueryBuilderMock(0))
        .mockReturnValueOnce(createQueryBuilderMock(0));

      const result = await service.sweepStaleDuels();

      expect(result).toEqual({ expiredPending: 0, voidedAccepted: 0 });
    });

    it('스윕된 결투의 양쪽 참가자에게 주입된 notifier로 알림을 보낸다', async () => {
      const notifier = jest.fn().mockResolvedValue(undefined);
      service.setNotifier(notifier);

      const expiredRow = {
        id: 7,
        challengerId: 'user-a',
        opponentId: 'user-b',
      };
      const voidedRow = { id: 8, challengerId: 'user-c', opponentId: 'user-d' };
      (duelRepo.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(createQueryBuilderMock(1, [expiredRow]))
        .mockReturnValueOnce(createQueryBuilderMock(1, [voidedRow]));

      await service.sweepStaleDuels();

      expect(notifier).toHaveBeenCalledWith('user-a', 'duel:expired', {
        duelId: 7,
      });
      expect(notifier).toHaveBeenCalledWith('user-b', 'duel:expired', {
        duelId: 7,
      });
      expect(notifier).toHaveBeenCalledWith('user-c', 'duel:voided', {
        duelId: 8,
      });
      expect(notifier).toHaveBeenCalledWith('user-d', 'duel:voided', {
        duelId: 8,
      });
    });
  });
});
