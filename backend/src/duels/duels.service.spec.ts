import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DuelsService } from './duels.service';
import { Duel, DuelStatus } from './entities/duel.entity';
import { RedisService } from '../common/redis/redis.service';
import { ErrorCode } from '../common/errors/error-code';
import { UsersService } from '../users/users.service';
import { ScoresService } from '../scores/scores.service';
import { ModerationService } from '../moderation/moderation.service';
import { ScoreEventType } from '../scores/entities/score-event.entity';
import {
  BASE_DUEL_SCORE,
  ALLY_BONUS_MULTIPLIER,
  DUEL_NO_RESPONSE_SCORE_PENALTY,
  DUEL_REJECT_SCORE_PENALTY,
  DUEL_SHIELD_TTL,
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
    update: jest.Mock;
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
      | 'setDuelShield'
      | 'getDuelShieldTtl'
      | 'clearDuelShield'
      | 'geoPos'
      | 'geoPosMany'
      | 'geoSearch'
      | 'getUserMeta'
    >
  >;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findById' | 'findByIds' | 'applyScoreDelta'>
  >;
  let scoresService: jest.Mocked<Pick<ScoresService, 'record'>>;
  let moderation: { getBlockedBy: jest.Mock };

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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
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
      setDuelShield: jest.fn().mockResolvedValue(undefined),
      // 기본값: 아무도 거절 보호 중이 아님.
      getDuelShieldTtl: jest.fn().mockResolvedValue(0),
      clearDuelShield: jest.fn().mockResolvedValue(false),
      geoPos: jest.fn().mockResolvedValue({ lat: 35.1, lng: 129.05 }),
      geoPosMany: jest.fn().mockResolvedValue(new Map()),
      geoSearch: jest.fn().mockResolvedValue([]),
      getUserMeta: jest
        .fn()
        .mockResolvedValue({ team: 'JP', socketId: 'socket-1' }),
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
    // 기본값: 아무도 신청자를 차단하지 않음.
    moderation = { getBlockedBy: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuelsService,
        { provide: getRepositoryToken(Duel), useValue: duelRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
        { provide: UsersService, useValue: usersService },
        { provide: ScoresService, useValue: scoresService },
        { provide: ModerationService, useValue: moderation },
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

    // 차단을 채팅에만 걸면, 차단당한 쪽이 결투 신청을 반복해 duel:requested 알림으로
    // 계속 접촉할 수 있어 "악성 사용자 차단"이 반쪽이 된다.
    it('나를 차단한 상대에게는 결투를 신청할 수 없다', async () => {
      moderation.getBlockedBy.mockResolvedValue([opponentId]);

      const err = await service
        .requestDuel(challenger, opponentId)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(moderation.getBlockedBy).toHaveBeenCalledWith(challenger.id);
      // 차단 사실을 드러내면 차단 여부를 탐지하는 수단이 된다.
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: ErrorCode.DUEL_TARGET_UNAVAILABLE,
      });
    });

    it('다른 사람을 차단했더라도 대상이 아니면 신청할 수 있다', async () => {
      moderation.getBlockedBy.mockResolvedValue(['someone-else']);

      await expect(
        service.requestDuel(challenger, opponentId),
      ).resolves.toBeDefined();
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

    /**
     * findById·getUserMeta·verifyProximity는 전부 트랜잭션 밖이라, advisory lock을
     * 기다리는 사이 대상이 탈퇴를 완료할 수 있다. 잡지 않으면 QueryFailedError가 그대로
     * 새어나가 신청자가 404 대신 500을 받는다.
     */
    it('신청 도중 상대가 탈퇴하면 500이 아니라 404를 낸다', async () => {
      const fkError = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message: 'insert or update on table "duels" violates foreign key',
        code: '23503',
      } as unknown as Error);
      txManager.save.mockRejectedValue(fkError);

      const err = await service
        .requestDuel(challenger, opponentId)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toMatchObject({
        code: ErrorCode.DUEL_TARGET_NOT_FOUND,
      });
      // 락은 row id를 토큰으로 쓰므로, row가 없으면 애초에 잡지 않는다.
      expect(redis.tryAcquireLock).not.toHaveBeenCalled();
    });

    // FK 위반이 아닌 DB 오류까지 404로 뭉개면 진짜 장애가 "없는 유저"로 감춰진다.
    it('FK 위반이 아닌 DB 오류는 그대로 올린다', async () => {
      const other = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message: 'deadlock detected',
        code: '40P01',
      } as unknown as Error);
      txManager.save.mockRejectedValue(other);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toBe(
        other,
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

    it('상대가 거절 보호 중이면 결투를 신청할 수 없다', async () => {
      redis.getDuelShieldTtl.mockResolvedValue(300);

      const err = await service
        .requestDuel(challenger, opponentId)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: ErrorCode.DUEL_TARGET_SHIELDED,
      });
      // 보호막 판정은 위치 검증(PostGIS)보다 앞이라 불필요한 왕복이 없어야 한다.
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(txManager.save).not.toHaveBeenCalled();
    });

    // 보호막은 "남이 나에게 못 건다"일 뿐이다 — 내가 거는 건 막지 않고, 대신 그 순간 걷힌다.
    it('신청이 성립하면 신청자 본인의 보호막은 해제한다', async () => {
      redis.clearDuelShield.mockResolvedValue(true);

      await service.requestDuel(challenger, opponentId);

      expect(redis.clearDuelShield).toHaveBeenCalledWith(challenger.id);
      // 상대 보호막만 확인하고, 본인 것은 조회로 막지 않는다.
      expect(redis.getDuelShieldTtl).toHaveBeenCalledWith(opponentId);
      expect(redis.getDuelShieldTtl).not.toHaveBeenCalledWith(challenger.id);
    });

    // 사거리 밖·중복 신청 같은 실패한 시도까지 "공격"으로 세면 실수 한 번에 보호가 날아간다.
    it('신청이 튕기면 신청자 보호막은 그대로 둔다', async () => {
      dataSource.query.mockResolvedValue([{ id: opponentId, within: false }]);

      await expect(service.requestDuel(challenger, opponentId)).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.clearDuelShield).not.toHaveBeenCalled();
    });

    // 결투는 이미 만들어졌고 락도 잡힌 뒤다. 여기서 던지면 신청자만 500을 받고
    // 결투는 만료(30초)까지 살아 있어 아무것도 못 하게 된다.
    it('보호막 해제가 실패해도 신청 자체는 성공시킨다', async () => {
      redis.clearDuelShield.mockRejectedValue(new Error('redis down'));

      const duel = await service.requestDuel(challenger, opponentId);

      expect(duel.status).toBe(DuelStatus.PENDING);
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

    it('거절하면 거절한 쪽의 개인 점수를 깎고 원장에 남긴다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());

      const duel = await service.respondDuel(1, opponentId, false);

      expect(duel.scoreDelta).toBe(DUEL_REJECT_SCORE_PENALTY);
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -DUEL_REJECT_SCORE_PENALTY,
        txManager,
      );
      // 신청자 쪽은 아무 변동이 없다 — 거절에는 승자가 없다.
      expect(usersService.applyScoreDelta).toHaveBeenCalledTimes(1);
      expect(scoresService.record).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({
          userId: opponentId,
          type: ScoreEventType.DUEL_REJECT,
          personalPoints: -DUEL_REJECT_SCORE_PENALTY,
          // 결투 점수는 팀 점수에 절대 포함되지 않는다 (기획 확정).
          teamPoints: 0,
          duelId: 1,
        }),
      );
    });

    it('거절하면 거절한 쪽에 보호 기간을 건다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());

      await service.respondDuel(1, opponentId, false);

      expect(redis.setDuelShield).toHaveBeenCalledWith(
        opponentId,
        DUEL_SHIELD_TTL,
      );
    });

    it('수락에는 점수 차감도 보호 기간도 없다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());

      await service.respondDuel(1, opponentId, true);

      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setDuelShield).not.toHaveBeenCalled();
    });

    // 상태 전이(CAS)와 점수 차감은 한 트랜잭션이다. CAS가 밀리면 차감도 원장도 남으면 안 된다.
    it('이미 처리된 결투를 거절하면 점수도 보호막도 건드리지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      await expect(service.respondDuel(1, opponentId, false)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(scoresService.record).not.toHaveBeenCalled();
      expect(redis.setDuelShield).not.toHaveBeenCalled();
    });

    // 거절과 -2점은 이미 커밋됐다. 여기서 던지면 응답자는 에러 ack만 받고 duel:rejected를
    // 못 받으며, 재시도는 409·30초 타이머는 null이라 양쪽이 대기 화면에 갇힌다.
    it('보호막 설정이 실패해도 거절 자체는 성공시킨다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      redis.setDuelShield.mockRejectedValue(new Error('redis down'));

      const duel = await service.respondDuel(1, opponentId, false);

      expect(duel.status).toBe(DuelStatus.REJECTED);
      expect(redis.releaseLock).toHaveBeenCalledWith(expect.any(String), '1');
    });

    it('락 해제가 실패해도 거절 자체는 성공시킨다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      redis.releaseLock.mockRejectedValue(new Error('redis down'));

      await expect(
        service.respondDuel(1, opponentId, false),
      ).resolves.toMatchObject({ status: DuelStatus.REJECTED });
    });

    // 상대가 이미 탈퇴했으면 깎을 대상이 없다 — 그런데도 scoreDelta를 박으면
    // 일어나지 않은 차감이 DB와 알림에 남는다.
    it('깎을 대상이 없으면 scoreDelta를 남기지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      usersService.findById.mockResolvedValue(null);

      const duel = await service.respondDuel(1, opponentId, false);

      expect(duel.scoreDelta).toBeNull();
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setDuelShield).not.toHaveBeenCalled();
    });
  });

  describe('finishByGame / voidByGame / 아군 보너스', () => {
    const buildAcceptedDuel = (): Duel =>
      ({
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.ACCEPTED,
      }) as Duel;

    it('승자가 참가자가 아니면 거부한다 (조작된 판정 차단)', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());

      await expect(service.finishByGame(1, 'user-c')).rejects.toThrow(
        BadRequestException,
      );
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });

    it('수락 상태가 아닌 결투는 미니게임 결과를 받지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue({
        ...buildAcceptedDuel(),
        status: DuelStatus.VOID,
      });

      await expect(service.finishByGame(1, challenger.id)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });

    it('voidByGame은 VOID로 전이하고 락을 해제한다 — 점수 변동은 없다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());

      const voided = await service.voidByGame(1);

      expect(voided?.status).toBe(DuelStatus.VOID);
      expect(redis.releaseLock).toHaveBeenCalledWith(expect.any(String), '1');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setPenalty).not.toHaveBeenCalled();
    });

    /**
     * 락 해제 시점엔 점수·원장·페널티가 이미 커밋돼 있다. 여기서 예외를 올리면
     * MinigameService.settle의 catch가 결과를 삼키고, 재시도는 getAcceptedDuel에서
     * COMPLETED/VOID를 보고 null로 접는다 — 스윕도 종료 상태는 건드리지 않아
     * 아무도 duel:completed를 받지 못한 채 점수만 움직인다. 락은 TTL로 회수된다.
     */
    it('락 해제가 실패해도 finishByGame은 확정 결과를 돌려준다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoSearch.mockResolvedValue([]);
      redis.releaseLock.mockRejectedValue(new Error('redis down'));

      const outcome = await service.finishByGame(1, challenger.id);

      expect(outcome.status).toBe('confirmed');
      if (outcome.status === 'confirmed') {
        expect(outcome.duel.winnerId).toBe(challenger.id);
      }
    });

    it('락 해제가 실패해도 voidByGame은 VOID 결과를 돌려준다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.releaseLock.mockRejectedValue(new Error('redis down'));

      const voided = await service.voidByGame(1);

      expect(voided?.status).toBe(DuelStatus.VOID);
    });

    it('미니게임 승자에게 기본 점수를 적용하고 패자에게 30분 페널티를 건다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      // 아군 보너스 조건 미충족: 주변에 같은 팀 후보가 없음
      redis.geoSearch.mockResolvedValue([]);

      const outcome = await service.finishByGame(1, challenger.id);

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
      redis.geoSearch.mockResolvedValue([]);

      await service.finishByGame(1, challenger.id);

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
      redis.geoSearch.mockResolvedValue([]);
      usersService.findByIds.mockResolvedValue([
        { id: challenger.id, team: challenger.team },
      ] as never);

      await service.finishByGame(1, challenger.id);

      expect(scoresService.record).toHaveBeenCalledTimes(1);
      expect(scoresService.record).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({ userId: challenger.id }),
      );
    });

    it('팀 스냅샷 이후 참가자가 사라져도 그 원장 행만 건너뛰고 결투는 확정된다', async () => {
      // 팀 스냅샷은 트랜잭션 밖에서 읽으므로, 그 뒤 참가자가 삭제되면 스킵 판정이 낡아
      // 사라진 uuid로 insert를 시도한다(FK 위반). Postgres는 실패한 문이 트랜잭션 전체를
      // abort시키므로, SAVEPOINT로 되돌리지 않으면 결투 확정까지 함께 날아간다.
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoSearch.mockResolvedValue([]);

      const fkError = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message:
          'insert or update on table "score_events" violates foreign key constraint',
        code: '23503',
      } as unknown as Error);
      // 패자만 사라진 상황 — 승자 행은 정상 기록돼야 한다.
      scoresService.record.mockImplementation((_m, event) =>
        event.userId === opponentId
          ? Promise.reject(fkError)
          : Promise.resolve(undefined),
      );

      await expect(
        service.finishByGame(1, challenger.id),
      ).resolves.toMatchObject({ status: 'confirmed' });

      expect(scoresService.record).toHaveBeenCalledTimes(2);
      // 실패한 insert만 SAVEPOINT로 되돌린다 — 트랜잭션은 계속 살아 있어야 한다.
      expect(txManager.query).toHaveBeenCalledWith(
        'ROLLBACK TO SAVEPOINT duel_ledger',
      );
      // 페널티 롤백은 트랜잭션 실패 경로에서만 일어난다 — 여기선 일어나면 안 된다.
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('FK 위반이 아닌 원장 insert 실패는 삼키지 않는다', async () => {
      // 23503만 "참가자가 사라짐"으로 읽는다. 그 외 오류까지 흡수하면 진짜 장애가 조용히 묻힌다.
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoSearch.mockResolvedValue([]);
      scoresService.record.mockRejectedValue(new Error('connection lost'));

      await expect(service.finishByGame(1, challenger.id)).rejects.toThrow(
        'connection lost',
      );
      // 트랜잭션이 깨졌으므로 미리 걸어둔 페널티는 되돌려야 한다.
      expect(redis.clearPenalty).toHaveBeenCalledWith(opponentId);
    });

    it('승자 주변에 아군이 2명 이상이면 1.5배 점수를 적용한다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());

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

      const outcome = await service.finishByGame(1, challenger.id);

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
        .mockResolvedValueOnce(buildAcceptedDuel()) // finishByGame의 초기 조회
        .mockResolvedValueOnce(alreadyCompleted); // resolveDuel CAS 실패 후 재조회
      // 다른 요청이 이미
      // ACCEPTED -> COMPLETED 전환을 선점해 트랜잭션 내 CAS가 실패 (affected=0)
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const outcome = await service.finishByGame(1, challenger.id);

      expect(outcome.status).toBe('confirmed');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      // 선점한 처리가 COMPLETED를 커밋했으므로 패자 페널티는 정당 — 되돌리지 않는다
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('정리 잡이 먼저 VOID 처리한 결투는 confirmed 대신 void로 반환한다', async () => {
      const sweptVoid = {
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.VOID,
        winnerId: null,
      } as Duel;

      duelRepo.findOne
        .mockResolvedValueOnce(buildAcceptedDuel()) // finishByGame의 초기 조회
        .mockResolvedValueOnce(sweptVoid); // resolveDuel CAS 실패 후 재조회
      // 스윕이 이미
      // ACCEPTED -> VOID 전환을 선점해 트랜잭션 내 CAS가 실패 (affected=0)
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const outcome = await service.finishByGame(1, challenger.id);

      expect(outcome.status).toBe('void');
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      // VOID로 끝났으니 승패 미확정 — 이번 호출이 새로 만든 페널티는 되돌린다
      expect(redis.clearPenalty).toHaveBeenCalledWith(opponentId);
    });

    it('markResultInProgress는 스윕이 이미 VOID를 커밋했으면 거부한다', async () => {
      // 스윕이 ACCEPTED -> VOID를 커밋해 스탬프 UPDATE가 affected=0
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      await expect(service.markResultInProgress(1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('점수 반영이 실패하면 상태 확정도 함께 롤백되고, 새로 만든 페널티를 되돌린다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoSearch.mockResolvedValue([]);
      usersService.applyScoreDelta.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.finishByGame(1, challenger.id)).rejects.toThrow(
        'DB connection lost',
      );

      // CAS와 점수 반영이 같은 트랜잭션이므로 에러 전파 = 전체 롤백(결투는 ACCEPTED 유지,
      // 신고 스탬프가 신선해 스윕도 유예됨) — 재시도가 가능한 상태로 남아야 한다
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(redis.clearPenalty).toHaveBeenCalledWith(opponentId);
    });

    it('트랜잭션 실패 시 기존에 있던 페널티(created=false)는 건드리지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoSearch.mockResolvedValue([]);
      redis.setPenalty.mockResolvedValue({ created: false });
      usersService.applyScoreDelta.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.finishByGame(1, challenger.id)).rejects.toThrow(
        'DB connection lost',
      );
      expect(redis.clearPenalty).not.toHaveBeenCalled();
    });

    it('아군 보너스 판정(Redis)이 실패하면 상태 커밋·페널티 전에 중단되어 재시도 가능하다', async () => {
      duelRepo.findOne.mockResolvedValue(buildAcceptedDuel());
      redis.geoPos.mockRejectedValue(new Error('Redis down'));

      await expect(service.finishByGame(1, challenger.id)).rejects.toThrow(
        'Redis down',
      );

      // 아직 아무것도 커밋되지 않았어야 한다 (결투는 ACCEPTED 유지 → 재시도로 복구)
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(redis.setPenalty).not.toHaveBeenCalled();
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
    });
  });

  describe('expireDuel (무응답 만료)', () => {
    const buildPendingDuel = (): Duel =>
      ({
        id: 1,
        challengerId: challenger.id,
        opponentId,
        status: DuelStatus.PENDING,
      }) as Duel;

    const stubExpireUpdate = (affected: number) => {
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(
          affected,
          affected > 0
            ? [{ id: 1, challengerId: challenger.id, opponentId }]
            : [],
        ),
      );
    };

    it('무응답도 거절과 같은 금액을 응답하지 않은 쪽에서 깎는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(1);
      usersService.findByIds.mockResolvedValue([
        { id: opponentId, team: 'JP' },
      ] as never);

      const duel = await service.expireDuel(1);

      expect(duel?.status).toBe(DuelStatus.EXPIRED);
      expect(duel?.scoreDelta).toBe(DUEL_NO_RESPONSE_SCORE_PENALTY);
      expect(DUEL_NO_RESPONSE_SCORE_PENALTY).toBe(DUEL_REJECT_SCORE_PENALTY);
      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        opponentId,
        -DUEL_NO_RESPONSE_SCORE_PENALTY,
        txManager,
      );
      expect(scoresService.record).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({
          userId: opponentId,
          type: ScoreEventType.DUEL_NO_RESPONSE,
          teamPoints: 0,
        }),
      );
    });

    /**
     * 보호막이 없으면 만료 직후 페어 락이 풀리고 활성 결투도 없어져, 같은 신청자가
     * 30초마다 다시 걸 수 있다 — 비용 0으로 상대 점수만 시간당 240점씩 빨아낸다.
     */
    it('무응답으로 깎인 유저에게도 보호 기간을 준다 (반복 신청 파밍 차단)', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(1);
      usersService.findByIds.mockResolvedValue([
        { id: opponentId, team: 'JP' },
      ] as never);

      await service.expireDuel(1);

      expect(redis.setDuelShield).toHaveBeenCalledWith(
        opponentId,
        DUEL_SHIELD_TTL,
      );
    });

    // 팀 조회가 기본 리포지토리로 새면 트랜잭션이 커넥션을 쥔 채 두 번째를 잡아,
    // 만료 타이머가 풀 크기만큼 동시에 발화하면 전원이 서로를 기다리다 멈춘다.
    it('원장용 팀 조회를 트랜잭션 커넥션으로 한다 (커넥션 풀 데드락 차단)', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(1);

      await service.expireDuel(1);

      expect(usersService.findByIds).toHaveBeenCalledWith(
        [opponentId],
        txManager,
      );
    });

    it('이미 처리된 결투는 점수도 보호막도 건드리지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(0);

      await expect(service.expireDuel(1)).resolves.toBeNull();
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setDuelShield).not.toHaveBeenCalled();
    });

    // 상대가 이미 탈퇴했으면 깎을 대상이 없다 — 그런데도 scoreDelta를 박으면
    // DB와 알림이 "아무도 아닌 사람이 2점 깎였다"고 주장하게 된다.
    it('깎을 대상이 없으면 scoreDelta를 남기지 않는다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(1);
      usersService.findByIds.mockResolvedValue([]);

      const duel = await service.expireDuel(1);

      expect(duel?.status).toBe(DuelStatus.EXPIRED);
      expect(duel?.scoreDelta).toBeNull();
      expect(usersService.applyScoreDelta).not.toHaveBeenCalled();
      expect(redis.setDuelShield).not.toHaveBeenCalled();
    });

    // 만료는 이미 커밋됐다. 여기서 던지면 아무도 duel:expired를 못 보내 양쪽이 갇힌다.
    it('락 해제가 실패해도 만료 결과를 돌려준다', async () => {
      duelRepo.findOne.mockResolvedValue(buildPendingDuel());
      stubExpireUpdate(1);
      redis.releaseLock.mockRejectedValue(new Error('redis down'));

      await expect(service.expireDuel(1)).resolves.toMatchObject({
        status: DuelStatus.EXPIRED,
      });
    });
  });

  describe('sweepStaleDuels', () => {
    it('오래된 PENDING은 EXPIRED로, 오래된 ACCEPTED는 VOID로 전이하고 건수를 반환한다', async () => {
      // PENDING 전이는 차감과 함께 트랜잭션 안에서 돈다 (txManager), VOID 전이는 밖이다.
      const pendingQb = createQueryBuilderMock(2);
      const acceptedQb = createQueryBuilderMock(3);
      txManager.createQueryBuilder.mockReturnValueOnce(pendingQb);
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        acceptedQb,
      );

      const result = await service.sweepStaleDuels();

      expect(result).toEqual({ expiredPending: 2, voidedAccepted: 3 });
      // scoreDelta는 전이 UPDATE가 아니라 실제 차감이 일어난 행에만 따로 찍힌다.
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
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(0),
      );
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );

      const result = await service.sweepStaleDuels();

      expect(result).toEqual({ expiredPending: 0, voidedAccepted: 0 });
    });

    it('스윕된 결투의 양쪽 참가자에게 주입된 notifier로 알림을 보낸다', async () => {
      const notifier = jest.fn().mockResolvedValue(undefined);
      service.setNotifier(notifier);

      // RETURNING은 차감 전 스냅샷이라 scoreDelta가 비어 있고, 차감이 실제로 적용된 뒤
      // 서비스가 채워 넣는다 — user-b의 팀을 읽을 수 있어야 차감 대상이 된다.
      const expiredRow = {
        id: 7,
        challengerId: 'user-a',
        opponentId: 'user-b',
      };
      usersService.findByIds.mockResolvedValue([
        { id: 'user-b', team: 'JP' },
      ] as never);
      const voidedRow = { id: 8, challengerId: 'user-c', opponentId: 'user-d' };
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(1, [expiredRow]),
      );
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(1, [voidedRow]),
      );

      await service.sweepStaleDuels();

      // 무응답 만료 payload는 양쪽에 동일하고, 깎인 쪽만 penalizedUserId로 지목한다.
      const expiredPayload = {
        duelId: 7,
        scorePenalty: DUEL_NO_RESPONSE_SCORE_PENALTY,
        penalizedUserId: 'user-b',
        // 큐잉되어도 낡지 않도록 남은 초가 아니라 절대 시각으로 나간다.
        shieldUntil: expect.any(String) as unknown as string,
      };
      expect(notifier).toHaveBeenCalledWith(
        'user-a',
        'duel:expired',
        expiredPayload,
      );
      expect(notifier).toHaveBeenCalledWith(
        'user-b',
        'duel:expired',
        expiredPayload,
      );
      // VOID는 차감이 없다 — scoreDelta가 비어 penalizedUserId도 null이다.
      const voidedPayload = {
        duelId: 8,
        scorePenalty: 0,
        penalizedUserId: null,
        shieldUntil: null,
      };
      expect(notifier).toHaveBeenCalledWith(
        'user-c',
        'duel:voided',
        voidedPayload,
      );
      expect(notifier).toHaveBeenCalledWith(
        'user-d',
        'duel:voided',
        voidedPayload,
      );
    });

    it('무응답으로 만료된 신청은 응답하지 않은 쪽의 점수를 깎고 원장에 남긴다', async () => {
      txManager.createQueryBuilder.mockReturnValueOnce(
        createQueryBuilderMock(1, [
          {
            id: 7,
            challengerId: 'user-a',
            opponentId: 'user-b',
            scoreDelta: 2,
          },
        ]),
      );
      (duelRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(
        createQueryBuilderMock(0),
      );
      usersService.findByIds.mockResolvedValue([
        { id: 'user-b', team: 'JP' },
      ] as never);

      await service.sweepStaleDuels();

      expect(usersService.applyScoreDelta).toHaveBeenCalledWith(
        'user-b',
        -DUEL_NO_RESPONSE_SCORE_PENALTY,
        txManager,
      );
      // 신청자는 아무 손해가 없다 — 응답하지 않은 쪽만 문다.
      expect(usersService.applyScoreDelta).toHaveBeenCalledTimes(1);
      expect(scoresService.record).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({
          userId: 'user-b',
          type: ScoreEventType.DUEL_NO_RESPONSE,
          personalPoints: -DUEL_NO_RESPONSE_SCORE_PENALTY,
          teamPoints: 0,
          duelId: 7,
        }),
      );
    });
  });

  /**
   * 탈퇴로 참가자가 사라진 활성 결투는 상대를 막는다 — hasActiveDuel이 고아 행을 계속
   * 활성으로 세고, lockKey가 NULL로 계산돼 엉뚱한 키를 건드린다.
   */
  describe('terminateActiveDuelsFor / settleTerminatedDuels', () => {
    it('PENDING은 EXPIRED, ACCEPTED는 VOID로 전이하고 advisory lock을 먼저 잡는다', async () => {
      const pendingQb = createQueryBuilderMock(1, [
        { id: 7, challengerId: 'user-a', opponentId: 'user-b' },
      ]);
      const acceptedQb = createQueryBuilderMock(1, [
        { id: 8, challengerId: 'user-c', opponentId: 'user-a' },
      ]);
      txManager.createQueryBuilder
        .mockReturnValueOnce(pendingQb)
        .mockReturnValueOnce(acceptedQb);

      const rows = await service.terminateActiveDuelsFor(
        'user-a',
        txManager as never,
      );

      // requestDuel과 같은 키를 잡아야 종료~유저 삭제 사이 신규 신청이 직렬화된다.
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['duel:user:user-a'],
      );
      expect(pendingQb.set).toHaveBeenCalledWith({
        status: DuelStatus.EXPIRED,
      });
      expect(acceptedQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: DuelStatus.VOID }),
      );
      expect(rows).toEqual([
        {
          id: 7,
          challengerId: 'user-a',
          opponentId: 'user-b',
          event: 'duel:expired',
        },
        {
          id: 8,
          challengerId: 'user-c',
          opponentId: 'user-a',
          event: 'duel:voided',
        },
      ]);
    });

    // 유저 삭제 전에 돌아야 참가자 id가 살아 있어 락 키와 알림 대상을 알 수 있다.
    it('종료 대상이 없으면 아무 뒷정리도 하지 않는다', async () => {
      const notifier = jest.fn().mockResolvedValue(undefined);
      service.setNotifier(notifier);

      await service.settleTerminatedDuels([], 'user-a');

      expect(redis.releaseLock).not.toHaveBeenCalled();
      expect(notifier).not.toHaveBeenCalled();
    });

    it('페어 락을 row id 토큰으로 CAS 해제하고, 남는 상대에게만 알린다', async () => {
      const notifier = jest.fn().mockResolvedValue(undefined);
      service.setNotifier(notifier);

      await service.settleTerminatedDuels(
        [
          {
            id: 7,
            challengerId: 'user-a',
            opponentId: 'user-b',
            event: 'duel:expired',
          },
          {
            id: 8,
            challengerId: 'user-c',
            opponentId: 'user-a',
            event: 'duel:voided',
          },
        ],
        'user-a',
      );

      // 키는 두 id를 정렬해 만들고, 토큰은 requestDuel과 같은 규칙(row id)이다.
      expect(redis.releaseLock).toHaveBeenCalledWith(
        'duel:lock:user-a:user-b',
        '7',
      );
      expect(redis.releaseLock).toHaveBeenCalledWith(
        'duel:lock:user-a:user-c',
        '8',
      );

      // 탈퇴로 끝난 결투는 아무도 응답을 회피한 게 아니라 차감이 없다 — scoreDelta가
      // 비어 있어 payload도 0/null로 나간다.
      expect(notifier).toHaveBeenCalledWith('user-b', 'duel:expired', {
        duelId: 7,
        scorePenalty: 0,
        penalizedUserId: null,
        shieldUntil: null,
      });
      expect(notifier).toHaveBeenCalledWith('user-c', 'duel:voided', {
        duelId: 8,
        scorePenalty: 0,
        penalizedUserId: null,
        shieldUntil: null,
      });
      // 탈퇴자에게는 보내지 않는다 — 큐는 곧 purgeUserKeys가 지운다.
      expect(notifier).not.toHaveBeenCalledWith(
        'user-a',
        expect.anything(),
        expect.anything(),
      );
    });

    // 계정은 이미 사라졌다 — Redis 실패로 탈퇴를 되돌릴 수 없다.
    it('락 해제가 실패해도 예외를 던지지 않는다', async () => {
      redis.releaseLock.mockRejectedValue(new Error('redis down'));

      await expect(
        service.settleTerminatedDuels(
          [
            {
              id: 7,
              challengerId: 'user-a',
              opponentId: 'user-b',
              event: 'duel:expired',
            },
          ],
          'user-a',
        ),
      ).resolves.toBeUndefined();
    });
  });
});
