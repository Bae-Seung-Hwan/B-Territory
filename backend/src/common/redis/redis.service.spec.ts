import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let client: {
    set: jest.Mock;
    del: jest.Mock;
    eval: jest.Mock;
    scan: jest.Mock;
    unlink: jest.Mock;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(RedisService);
    client = {
      set: jest.fn(),
      del: jest.fn(),
      eval: jest.fn(),
      scan: jest.fn(),
      unlink: jest.fn(),
    };
    // onModuleInit은 실제 접속을 생성하므로 클라이언트를 목으로 대체
    (service as unknown as { client: typeof client }).client = client;
  });

  describe('markDailyClaim / clearDailyClaim', () => {
    it('SET NX EX로 고유 토큰을 저장하고 created 여부·token을 반환한다', async () => {
      client.set.mockResolvedValueOnce('OK');

      const result = await service.markDailyClaim('user-1', 42, 86400);

      expect(result.created).toBe(true);
      expect(typeof result.token).toBe('string');
      expect(client.set).toHaveBeenCalledWith(
        'claim:daily:user-1:42',
        result.token,
        'EX',
        86400,
        'NX',
      );
    });

    it('이미 오늘 점령했으면(NX 실패) created=false를 반환한다', async () => {
      client.set.mockResolvedValueOnce(null);

      const result = await service.markDailyClaim('user-1', 42, 86400);

      expect(result.created).toBe(false);
    });

    it('호출마다 다른 token을 생성한다', async () => {
      client.set.mockResolvedValue('OK');

      const a = await service.markDailyClaim('user-1', 42, 86400);
      const b = await service.markDailyClaim('user-1', 42, 86400);

      expect(a.token).not.toBe(b.token);
    });

    it('clearDailyClaim은 무조건 DEL이 아니라 token 일치 여부를 확인하는 CAS(Lua)로 삭제한다', async () => {
      client.eval.mockResolvedValueOnce(1);

      await service.clearDailyClaim('user-1', 42, 'own-token');

      // releaseLock과 동일한 CAS 계약: 키/토큰을 Lua eval로 전달하고, DEL을 직접 호출하지 않는다
      // (자정 경계에서 다음날 다른 token으로 새로 생성된 키를 지연된 롤백이 지우는 것을 방지)
      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining('GET'),
        1,
        'claim:daily:user-1:42',
        'own-token',
      );
      expect(client.del).not.toHaveBeenCalled();
    });
  });

  describe('deleteByPattern', () => {
    it('SCAN 커서를 끝까지 따라가며 매 페이지의 키를 UNLINK하고 총 삭제 수를 반환한다', async () => {
      client.scan
        .mockResolvedValueOnce([
          '42',
          ['bull:spot-sync:repeat', 'bull:spot-sync:id'],
        ])
        .mockResolvedValueOnce(['0', ['bull:spot-sync:delayed']]);
      client.unlink.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const deleted = await service.deleteByPattern('bull:spot-sync:*');

      expect(deleted).toBe(3);
      expect(client.scan).toHaveBeenCalledTimes(2);
      expect(client.scan).toHaveBeenNthCalledWith(
        1,
        '0',
        'MATCH',
        'bull:spot-sync:*',
        'COUNT',
        100,
      );
      // 두 번째 SCAN은 첫 응답의 커서로 이어져야 한다
      expect(client.scan).toHaveBeenNthCalledWith(
        2,
        '42',
        'MATCH',
        'bull:spot-sync:*',
        'COUNT',
        100,
      );
      expect(client.unlink).toHaveBeenCalledWith(
        'bull:spot-sync:repeat',
        'bull:spot-sync:id',
      );
      expect(client.unlink).toHaveBeenCalledWith('bull:spot-sync:delayed');
    });

    it('매칭되는 키가 없으면 UNLINK 없이 0을 반환한다 (이미 정리된 환경에서 no-op)', async () => {
      client.scan.mockResolvedValue(['0', []]);

      const deleted = await service.deleteByPattern('bull:spot-sync:*');

      expect(deleted).toBe(0);
      expect(client.unlink).not.toHaveBeenCalled();
    });
  });

  /**
   * 탈퇴 시 남는 흔적을 고정한다. 새 기능이 유저 단위 키를 추가하면 여기도 같이
   * 늘어나야 하는데, 놓쳐도 어디서도 실패하지 않아 조용히 남는다.
   */
  describe('purgeUserKeys', () => {
    beforeEach(() => {
      const chain = {
        zrem: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      (
        service as unknown as { client: { pipeline: () => typeof chain } }
      ).client.pipeline = () => chain;
      client.scan.mockResolvedValue(['0', []]);
    });

    it('유저 단위 키를 패턴까지 빠짐없이 지운다', async () => {
      await service.purgeUserKeys('user-1');

      const patterns = client.scan.mock.calls.map(
        (call: unknown[]) => call[2] as string,
      );
      expect(patterns.sort()).toEqual(
        [
          'claim:daily:user-1:*',
          // 미션 API(#33)가 추가한 방문 창·일일 게이트. mission 자리는 photo·review로 갈린다.
          'mission:visit:user-1:*',
          'mission:*:daily:user-1:*',
          // 쌍 키라 유저 id가 어느 자리에 오는지 알 수 없다.
          'encounter:cooldown:*user-1*',
          'duel:lock:*user-1*',
        ].sort(),
      );
    });
  });

  describe('drainNotifications', () => {
    /** MULTI 체이닝을 흉내내 lrange 결과를 돌려주는 목을 심는다. */
    const stubDrain = (entries: string[]) => {
      const multi = {
        lrange: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, entries],
          [null, 1],
        ]),
      };
      (
        service as unknown as { client: { multi: () => typeof multi } }
      ).client.multi = () => multi;
    };

    it('쌓인 알림을 순서대로 파싱해 돌려준다', async () => {
      stubDrain([
        JSON.stringify({ event: 'duel:requested', payload: { id: 'd1' } }),
        JSON.stringify({ event: 'duel:completed', payload: { id: 'd1' } }),
      ]);

      await expect(service.drainNotifications('user-1')).resolves.toEqual([
        { event: 'duel:requested', payload: { id: 'd1' } },
        { event: 'duel:completed', payload: { id: 'd1' } },
      ]);
    });

    // 회귀 가드: 읽기가 파괴적이라(lrange+del이 먼저 확정) 엔트리 하나 때문에 throw하면
    // 이미 지워진 나머지 알림까지 영영 잃는다. 깨진 것만 버려야 한다.
    it('손상된 엔트리 하나 때문에 나머지 알림을 잃지 않는다', async () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      stubDrain([
        '{"event":"duel:requested","payl',
        JSON.stringify({ event: 'score:update', payload: { delta: 10 } }),
      ]);

      await expect(service.drainNotifications('user-1')).resolves.toEqual([
        { event: 'score:update', payload: { delta: 10 } },
      ]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
