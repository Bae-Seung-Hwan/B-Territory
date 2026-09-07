import { BadRequestException } from '@nestjs/common';
import { ConsentsService, assertConsentsComplete } from './consents.service';
import { ConsentDocument, REQUIRED_CONSENT_DOCUMENTS } from './constants';
import { ErrorCode } from '../common/errors/error-code';

const V = '2026-09-07';
const allItems = () =>
  REQUIRED_CONSENT_DOCUMENTS.map((document) => ({ document, version: V }));

describe('ConsentsService', () => {
  function makeService() {
    const repo = { find: jest.fn().mockResolvedValue([]) };
    const managerRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };
    const service = new ConsentsService(repo as never);
    return { service, repo, manager, managerRepo };
  }

  describe('recordAll', () => {
    it('필수 항목이 모두 오면 넘겨받은 manager의 트랜잭션으로 기록한다', async () => {
      const { service, manager, managerRepo } = makeService();

      await service.recordAll('user-1', allItems(), manager as never);

      // 자체 repo가 아니라 manager의 repo를 써야 가입 트랜잭션에 묶인다.
      expect(manager.getRepository).toHaveBeenCalled();
      expect(managerRepo.insert).toHaveBeenCalledWith(
        REQUIRED_CONSENT_DOCUMENTS.map((document) => ({
          userId: 'user-1',
          document,
          version: V,
        })),
      );
    });

    it('항목이 빠지면 아무것도 기록하지 않고 400을 던진다', async () => {
      const { service, manager, managerRepo } = makeService();
      const missingLocation = allItems().filter(
        (i) => i.document !== ConsentDocument.LOCATION,
      );

      await expect(
        service.recordAll('user-1', missingLocation, manager as never),
      ).rejects.toThrow(BadRequestException);
      // 부분 기록이 남으면 "일부만 동의한" 애매한 이력이 되므로 INSERT 자체가 없어야 한다.
      expect(managerRepo.insert).not.toHaveBeenCalled();
    });
  });

  describe('findLatestVersions', () => {
    it('문서별로 가장 최근 동의 버전만 남긴다', async () => {
      const { service, repo } = makeService();
      repo.find.mockResolvedValue([
        { id: 1, document: 'service', version: '2026-01-01' },
        { id: 2, document: 'privacy', version: '2026-01-01' },
        // 개정 후 재동의 — append-only라 같은 문서의 행이 하나 더 쌓인다.
        { id: 3, document: 'service', version: '2026-09-07' },
      ]);

      await expect(service.findLatestVersions('user-1')).resolves.toEqual({
        service: '2026-09-07',
        privacy: '2026-01-01',
      });
    });
  });
});

describe('assertConsentsComplete', () => {
  it('필수 항목이 모두 있으면 통과한다', () => {
    expect(() => assertConsentsComplete(allItems())).not.toThrow();
  });

  it.each(REQUIRED_CONSENT_DOCUMENTS)(
    '%s가 빠지면 CONSENT_INCOMPLETE로 막는다',
    (missing) => {
      const items = allItems().filter((i) => i.document !== missing);

      try {
        assertConsentsComplete(items);
        fail('예외가 발생해야 한다');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as {
          code: string;
          message: string;
        };
        expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
        // 어느 항목이 빠졌는지 메시지에 드러나야 프론트 배선 실수를 바로 찾는다.
        expect(body.message).toContain(missing);
      }
    },
  );

  it('같은 문서를 두 번 보내면 막는다 — 어느 버전이 실제 동의인지 알 수 없다', () => {
    const items = [
      ...allItems(),
      { document: ConsentDocument.SERVICE, version: '2020-01-01' },
    ];

    try {
      assertConsentsComplete(items);
      fail('예외가 발생해야 한다');
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
      expect(body.message).toContain('중복');
    }
  });

  it('빈 배열이면 필수 항목 전체를 누락으로 보고한다', () => {
    try {
      assertConsentsComplete([]);
      fail('예외가 발생해야 한다');
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        message: string;
      };
      for (const doc of REQUIRED_CONSENT_DOCUMENTS) {
        expect(body.message).toContain(doc);
      }
    }
  });
});
