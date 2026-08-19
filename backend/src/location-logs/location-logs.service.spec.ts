import { Logger } from '@nestjs/common';
import { LocationLogsService } from './location-logs.service';
import {
  ACQUISITION_PATH_DEVICE_GPS,
  LocationServiceCode,
  RETENTION_INTERVAL,
} from './constants';

describe('LocationLogsService', () => {
  function makeService() {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const execute = jest.fn().mockResolvedValue({ affected: 3 });
    const where = jest.fn().mockReturnValue({ execute });
    const del = jest.fn().mockReturnValue({ where });
    const repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue({ delete: del }),
    };
    const service = new LocationLogsService(repo as never, queue as never);
    return { service, queue, repo, where };
  }

  describe('record', () => {
    it('취득경로·제공받는자 기본값을 채워 큐에 적재한다', () => {
      const { service, queue } = makeService();

      service.record({
        subjectId: 'user-1',
        service: LocationServiceCode.SPOT_CLAIM,
      });

      expect(queue.add).toHaveBeenCalledWith(
        'record',
        {
          subjectId: 'user-1',
          service: LocationServiceCode.SPOT_CLAIM,
          // 이용자 단말에서 직접 수집 — 외부 위치정보사업자 경유가 아님
          acquisitionPath: ACQUISITION_PATH_DEVICE_GPS,
          // 제3자 제공이 없는 서비스라 항상 NULL
          recipient: null,
        },
        expect.objectContaining({ attempts: 5 }),
      );
    });

    it('큐 적재가 실패해도 호출자에게 예외를 던지지 않는다', () => {
      const { service, queue } = makeService();
      // 의도된 실패라 에러 로그가 테스트 출력을 오염시키지 않도록 막는다.
      const logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      queue.add.mockRejectedValue(new Error('redis down'));

      expect(() =>
        service.record({
          subjectId: 'user-1',
          service: LocationServiceCode.DUEL_MATCH,
        }),
      ).not.toThrow();

      logSpy.mockRestore();
    });
  });

  describe('purgeExpired', () => {
    it('보존기간(6개월)을 넘긴 행만 삭제한다', async () => {
      const { service, where } = makeService();

      await expect(service.purgeExpired()).resolves.toBe(3);
      expect(where).toHaveBeenCalledWith(
        expect.stringContaining('"usedAt" <'),
        {
          interval: RETENTION_INTERVAL,
        },
      );
    });
  });
});
