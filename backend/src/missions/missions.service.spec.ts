import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { MissionsService } from './missions.service';
import { ErrorCode } from '../common/errors/error-code';
import { ReviewMissionDto } from './dto/review-mission.dto';

/**
 * awardBonus의 FK 위반(23503) 해석을 고정한다.
 *
 * 이 트랜잭션에는 외부 상태에 달린 FK가 spotId(spots)와 userId(users) 둘이라,
 * 23503을 무조건 SPOT_NOT_FOUND로 읽으면 유저가 삭제된 경우에 "존재하는 관광지를
 * 찾을 수 없다"는 거짓 응답이 나간다.
 */
describe('MissionsService', () => {
  const reviewDto: ReviewMissionDto = { spotId: 1, rating: 5 };

  const fkError = new QueryFailedError('INSERT ...', [], {
    name: 'error',
    message:
      'insert or update on table "reviews" violates foreign key constraint',
    code: '23503',
  } as unknown as Error);

  /**
   * @param exists 트랜잭션 실패 후 존재 확인 쿼리가 돌려줄 값
   * @param txError 트랜잭션이 던질 에러
   */
  function makeService(
    exists: { spot_exists: boolean; user_exists: boolean },
    txError: unknown = fkError,
  ) {
    const dataSource = {
      // awardBonus의 트랜잭션은 실패시키고, 그 뒤 explainMissingReference의
      // 존재 확인 쿼리에는 지정한 값을 돌려준다.
      transaction: jest.fn().mockRejectedValue(txError),
      query: jest.fn().mockResolvedValue([exists]),
    };
    const redis = {
      // 체크인 완료(빈 문자열 = 방문했으나 sigungucode 없음) 상태를 기본값으로 둔다.
      getVisit: jest.fn().mockResolvedValue(''),
      markMissionDaily: jest
        .fn()
        .mockResolvedValue({ created: true, token: 'mission-token' }),
      clearMissionDaily: jest.fn().mockResolvedValue(undefined),
    };
    const districtsService = {
      getWeight: jest.fn().mockReturnValue(1),
      getCapitalMultiplier: jest.fn().mockResolvedValue(1),
    };
    const service = new MissionsService(
      {} as never,
      dataSource as never,
      redis as never,
      {} as never,
      { applyScoreDelta: jest.fn() } as never,
      { record: jest.fn() } as never,
      districtsService as never,
    );
    return { service, redis, dataSource };
  }

  it('spot이 사라진 FK 경합은 SPOT_NOT_FOUND 404로 변환한다', async () => {
    const { service, redis } = makeService({
      spot_exists: false,
      user_exists: true,
    });

    const err = await service
      .submitReview(reviewDto, 'user-1', 'A')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: ErrorCode.SPOT_NOT_FOUND,
    });
    // 점령이 확정되지 않았으므로 일일 게이트는 롤백되어야 한다.
    expect(redis.clearMissionDaily).toHaveBeenCalledWith(
      'review',
      'user-1',
      1,
      'mission-token',
    );
  });

  // 수정 전에는 이 경우도 SPOT_NOT_FOUND였다 — 멀쩡한 관광지를 "찾을 수 없다"고 답했다.
  it('유저가 사라진 FK 경합은 USER_NOT_REGISTERED 404로 변환한다', async () => {
    const { service } = makeService({ spot_exists: true, user_exists: false });

    const err = await service
      .submitReview(reviewDto, 'user-1', 'A')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: ErrorCode.USER_NOT_REGISTERED,
    });
  });

  it('참조가 모두 멀쩡하면 원인을 추측하지 않고 원본 에러를 전파한다', async () => {
    const { service } = makeService({ spot_exists: true, user_exists: true });

    await expect(service.submitReview(reviewDto, 'user-1', 'A')).rejects.toBe(
      fkError,
    );
  });

  it('FK 위반이 아닌 DB 에러는 존재 확인 없이 그대로 전파한다', async () => {
    const otherError = new QueryFailedError('INSERT ...', [], {
      name: 'error',
      message: 'connection terminated',
      code: '57P01',
    } as unknown as Error);
    const { service, dataSource } = makeService(
      { spot_exists: true, user_exists: true },
      otherError,
    );

    await expect(service.submitReview(reviewDto, 'user-1', 'A')).rejects.toBe(
      otherError,
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  describe('점수 배수', () => {
    // missions.service.ts의 REVIEW_PERSONAL_BASE(모듈 private). 바뀌면 이 테스트가 깨져서
    // 배수 계산을 다시 확인하게 되는 편이 낫다.
    const REVIEW_BASE = 50;

    /** 트랜잭션이 성공하는 서비스를 만들고, 원장에 기록된 개인 점수를 캡처한다. */
    function makeScoringService(weight: number, capitalMultiplier: number) {
      const record = jest.fn();
      const dataSource = {
        transaction: jest.fn(
          async (cb: (m: unknown) => Promise<unknown>) =>
            await cb({ insert: jest.fn() }),
        ),
        query: jest.fn(),
      };
      const districtsService = {
        getWeight: jest.fn().mockReturnValue(weight),
        getCapitalMultiplier: jest.fn().mockResolvedValue(capitalMultiplier),
      };
      const service = new MissionsService(
        {} as never,
        dataSource as never,
        {
          getVisit: jest.fn().mockResolvedValue('15'),
          markMissionDaily: jest
            .fn()
            .mockResolvedValue({ created: true, token: 't' }),
          clearMissionDaily: jest.fn().mockResolvedValue(undefined),
        } as never,
        {} as never,
        { applyScoreDelta: jest.fn() } as never,
        { record } as never,
        districtsService as never,
      );
      return { service, record };
    }

    it('구 가중치만 있으면 기본 점수에 가중치를 곱한다', async () => {
      const { service, record } = makeScoringService(2, 1);

      await service.submitReview(reviewDto, 'user-1', 'A');

      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ personalPoints: REVIEW_BASE * 2 }),
      );
    });

    // 수도 배수는 구 가중치와 같은 "구 단위 배수"라 미션에도 걸린다(claims와 동일).
    it('수도 구에서는 수도 배수까지 곱한다', async () => {
      const { service, record } = makeScoringService(2, 1.2);

      await service.submitReview(reviewDto, 'user-1', 'A');

      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          personalPoints: Math.round(REVIEW_BASE * 2 * 1.2),
        }),
      );
    });
  });
});
