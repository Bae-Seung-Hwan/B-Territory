import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let client: {
    set: jest.Mock;
    del: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(RedisService);
    client = { set: jest.fn(), del: jest.fn(), eval: jest.fn() };
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
});
