import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ClaimsService } from './claims.service';
import { VisitDto } from './dto/visit.dto';
import { LocationServiceCode } from '../location-logs/constants';

describe('ClaimsService', () => {
  describe('visit', () => {
    const visitDto: VisitDto = { spotId: 1, lat: 35.1796, lng: 129.0756 };

    // upsert는 점수 트랜잭션 내부의 manager.getRepository(SpotClaim).upsert 이므로,
    // 트랜잭션 매니저 목의 repo.upsert에 연결한다.
    function makeService(upsert: jest.Mock) {
      const managerRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        upsert,
      };
      const manager = {
        query: jest.fn().mockResolvedValue(undefined),
        getRepository: jest.fn().mockReturnValue(managerRepo),
      };
      const dataSource = {
        query: jest.fn().mockResolvedValue([
          {
            has_coords: true,
            within_range: true,
            distance: 10,
            sigungucode: '16',
          },
        ]),
        transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
          cb(manager),
        ),
      };
      const redis = {
        // 페널티 없음(#13 사전/TOCTOU 체크 통과), 일일 제한 통과(#19) 상태를 기본값으로 둔다.
        hasPenalty: jest.fn().mockResolvedValue(false),
        markDailyClaim: jest
          .fn()
          .mockResolvedValue({ created: true, token: 'daily-token' }),
        clearDailyClaim: jest.fn().mockResolvedValue(undefined),
        claimDefense: jest
          .fn()
          .mockResolvedValue({ status: 'ok', remaining: 300, created: true }),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const usersService = {
        applyScoreDelta: jest.fn().mockResolvedValue(undefined),
      };
      const scoresService = {
        record: jest.fn().mockResolvedValue(undefined),
      };
      const districtsService = { getWeight: jest.fn().mockReturnValue(1) };
      const locationLogs = { record: jest.fn() };
      const service = new ClaimsService(
        { upsert: jest.fn() } as never,
        {} as never,
        {} as never,
        dataSource as never,
        redis as never,
        usersService as never,
        scoresService as never,
        districtsService as never,
        locationLogs as never,
      );
      return { service, redis, locationLogs };
    }

    it('방문 확인과 점령 저장 사이에 spot이 삭제된 경합(FK 위반 23503)을 404로 변환한다', async () => {
      const fkError = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message:
          'insert or update on table "spot_claims" violates foreign key constraint',
        code: '23503',
      } as unknown as Error);
      const { service, redis } = makeService(
        jest.fn().mockRejectedValue(fkError),
      );

      await expect(
        service.visit(visitDto, 'user-1', 'A'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(redis.del).toHaveBeenCalledWith('defense:1');
    });

    it('점령이 실패해도 위치정보 이용사실은 기록한다 (법 제16조 2항)', async () => {
      const fkError = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message:
          'insert or update on table "spot_claims" violates foreign key constraint',
        code: '23503',
      } as unknown as Error);
      const { service, locationLogs } = makeService(
        jest.fn().mockRejectedValue(fkError),
      );

      await expect(
        service.visit(visitDto, 'user-1', 'A'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // 좌표를 전송받은 사실 자체는 인증 성공 여부와 무관하게 남아야 한다.
      expect(locationLogs.record).toHaveBeenCalledWith({
        subjectId: 'user-1',
        service: LocationServiceCode.SPOT_CLAIM,
      });
    });

    it('FK 위반이 아닌 다른 DB 에러는 그대로 전파한다', async () => {
      const otherError = new QueryFailedError('INSERT ...', [], {
        name: 'error',
        message: 'connection terminated',
        code: '57P01',
      } as unknown as Error);
      const { service } = makeService(jest.fn().mockRejectedValue(otherError));

      await expect(service.visit(visitDto, 'user-1', 'A')).rejects.toBe(
        otherError,
      );
    });
  });
});
