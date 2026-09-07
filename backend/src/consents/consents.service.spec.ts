import { BadRequestException } from '@nestjs/common';
import { ConsentsService, buildConsentRows } from './consents.service';
import {
  AGE_POLICY_VERSION,
  CLIENT_CONSENT_DOCUMENTS,
  ConsentDocument,
} from './constants';
import { ErrorCode } from '../common/errors/error-code';

const V = '2026-09-07';
const clientItems = () =>
  CLIENT_CONSENT_DOCUMENTS.map((document) => ({ document, version: V }));
const validInput = () => ({ consents: clientItems(), ageConfirmed: true });

function bodyOf(err: unknown) {
  return (err as BadRequestException).getResponse() as {
    code: string;
    message: string;
  };
}

describe('ConsentsService', () => {
  function makeService() {
    const repo = { find: jest.fn().mockResolvedValue([]) };
    const managerRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };
    const service = new ConsentsService(repo as never);
    return { service, repo, manager, managerRepo };
  }

  describe('recordAll', () => {
    it('넘겨받은 manager의 트랜잭션으로 기록한다', async () => {
      const { service, manager, managerRepo } = makeService();

      await service.recordAll('user-1', validInput(), manager as never);

      // 자체 repo가 아니라 manager의 repo를 써야 가입 트랜잭션에 묶인다.
      expect(manager.getRepository).toHaveBeenCalled();
      const rows = (
        managerRepo.insert.mock.calls as [
          { userId: string; document: string; version: string }[],
        ][]
      )[0][0];
      expect(rows.every((r) => r.userId === 'user-1')).toBe(true);
      expect(rows.map((r) => r.document).sort()).toEqual(
        [...CLIENT_CONSENT_DOCUMENTS, ConsentDocument.AGE_14_OVER].sort(),
      );
    });

    it('항목이 빠지면 아무것도 기록하지 않고 400을 던진다', async () => {
      const { service, manager, managerRepo } = makeService();
      const missingLocation = {
        consents: clientItems().filter(
          (i) => i.document !== ConsentDocument.LOCATION,
        ),
        ageConfirmed: true,
      };

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

describe('buildConsentRows', () => {
  it('클라이언트 문서 + 서버가 채우는 age14 행을 함께 만든다', () => {
    const rows = buildConsentRows(validInput());

    expect(rows).toEqual([
      ...clientItems(),
      // 프론트에 조항 전문이 없어 보낼 version이 없는 항목 — 서버 상수로 채운다.
      { document: ConsentDocument.AGE_14_OVER, version: AGE_POLICY_VERSION },
    ]);
  });

  it.each(CLIENT_CONSENT_DOCUMENTS)(
    '%s가 빠지면 CONSENT_INCOMPLETE로 막는다',
    (missing) => {
      const input = {
        consents: clientItems().filter((i) => i.document !== missing),
        ageConfirmed: true,
      };

      try {
        buildConsentRows(input);
        fail('예외가 발생해야 한다');
      } catch (err) {
        expect(bodyOf(err).code).toBe(ErrorCode.CONSENT_INCOMPLETE);
        // 어느 항목이 빠졌는지 메시지에 드러나야 프론트 배선 실수를 바로 찾는다.
        expect(bodyOf(err).message).toContain(missing);
      }
    },
  );

  it('ageConfirmed가 false면 age14 누락으로 막는다', () => {
    try {
      buildConsentRows({ consents: clientItems(), ageConfirmed: false });
      fail('예외가 발생해야 한다');
    } catch (err) {
      expect(bodyOf(err).code).toBe(ErrorCode.CONSENT_INCOMPLETE);
      expect(bodyOf(err).message).toContain(ConsentDocument.AGE_14_OVER);
    }
  });

  it('같은 문서를 두 번 보내면 막는다 — 어느 버전이 실제 동의인지 알 수 없다', () => {
    const input = {
      consents: [
        ...clientItems(),
        { document: ConsentDocument.SERVICE, version: '2020-01-01' },
      ],
      ageConfirmed: true,
    };

    try {
      buildConsentRows(input);
      fail('예외가 발생해야 한다');
    } catch (err) {
      expect(bodyOf(err).code).toBe(ErrorCode.CONSENT_INCOMPLETE);
      expect(bodyOf(err).message).toContain('중복');
    }
  });

  it('age14를 consents 배열로 보내면 막는다 — 서버가 채우는 항목이라 두 번 남는다', () => {
    const input = {
      consents: [
        ...clientItems(),
        { document: ConsentDocument.AGE_14_OVER, version: V },
      ],
      ageConfirmed: true,
    };

    try {
      buildConsentRows(input);
      fail('예외가 발생해야 한다');
    } catch (err) {
      expect(bodyOf(err).code).toBe(ErrorCode.CONSENT_INCOMPLETE);
      expect(bodyOf(err).message).toContain('서버가 채우는 항목');
    }
  });

  it('빈 배열이면 필수 항목 전체를 누락으로 보고한다', () => {
    try {
      buildConsentRows({ consents: [], ageConfirmed: false });
      fail('예외가 발생해야 한다');
    } catch (err) {
      for (const doc of [
        ...CLIENT_CONSENT_DOCUMENTS,
        ConsentDocument.AGE_14_OVER,
      ]) {
        expect(bodyOf(err).message).toContain(doc);
      }
    }
  });
});
