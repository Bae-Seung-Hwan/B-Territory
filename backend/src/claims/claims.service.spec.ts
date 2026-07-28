import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ClaimsService } from './claims.service';
import { VisitDto } from './dto/visit.dto';

describe('ClaimsService', () => {
  describe('visit', () => {
    const visitDto: VisitDto = { spotId: 1, lat: 35.1796, lng: 129.0756 };

    function makeService(upsert: jest.Mock) {
      const dataSource = {
        query: jest
          .fn()
          .mockResolvedValue([
            { has_coords: true, within_range: true, distance: 10 },
          ]),
      };
      const redis = {
        claimDefense: jest
          .fn()
          .mockResolvedValue({ status: 'ok', remaining: 300, created: true }),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const service = new ClaimsService(
        { upsert } as never,
        {} as never,
        dataSource as never,
        redis as never,
      );
      return { service, redis };
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
