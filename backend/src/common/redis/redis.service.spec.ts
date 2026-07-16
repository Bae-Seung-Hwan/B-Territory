import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let client: { scan: jest.Mock; unlink: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(RedisService);
    client = { scan: jest.fn(), unlink: jest.fn() };
    // onModuleInit은 실제 접속을 생성하므로 클라이언트를 목으로 대체
    (service as unknown as { client: typeof client }).client = client;
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
});
