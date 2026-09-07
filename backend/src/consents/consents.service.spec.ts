import { BadRequestException } from '@nestjs/common';
import { ConsentsService, buildConsentRows } from './consents.service';
import {
  AGE_POLICY_VERSION,
  CLIENT_CONSENT_DOCUMENTS,
  CONSENT_VERSION_PATTERN,
  ConsentDocument,
  SERVER_CONSENT_ROWS,
} from './constants';
import { ErrorCode } from '../common/errors/error-code';

const V = '2026-09-07';
const clientItems = () =>
  CLIENT_CONSENT_DOCUMENTS.map((document) => ({ document, version: V }));
const validInput = () => ({ consents: clientItems(), ageConfirmed: true });

/**
 * `run`이 던진 예외의 응답 본문을 돌려준다. 던지지 않으면 그 자체로 실패시킨다.
 *
 * jest의 전역 `fail()`을 쓰지 않는다 — jest 30은 jasmine2를 뺐고 jest-circus에는 `fail`이
 * 없어(@types/jest에는 남아 있어 tsc는 통과한다) 실제로는 ReferenceError가 난다. 그게
 * try 안에서 나면 같은 catch에 잡혀, "안 던졌다"가 "getResponse is not a function"으로
 * 둔갑해 원인을 가린다. 여기서는 try 밖에서 던져 그런 일이 없다.
 */
function expectThrownBody(run: () => unknown) {
  try {
    run();
  } catch (err) {
    return (err as BadRequestException).getResponse() as {
      code: string;
      message: string;
    };
  }
  throw new Error('예외가 발생해야 하는데 정상 반환됐다');
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

      const body = expectThrownBody(() => buildConsentRows(input));

      expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
      // 어느 항목이 빠졌는지 메시지에 드러나야 프론트 배선 실수를 바로 찾는다.
      expect(body.message).toContain(missing);
    },
  );

  it('ageConfirmed가 false면 age14 누락으로 막는다', () => {
    const body = expectThrownBody(() =>
      buildConsentRows({ consents: clientItems(), ageConfirmed: false }),
    );

    expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
    expect(body.message).toContain(ConsentDocument.AGE_14_OVER);
  });

  it('같은 문서를 두 번 보내면 막는다 — 어느 버전이 실제 동의인지 알 수 없다', () => {
    const input = {
      consents: [
        ...clientItems(),
        { document: ConsentDocument.SERVICE, version: '2020-01-01' },
      ],
      ageConfirmed: true,
    };

    const body = expectThrownBody(() => buildConsentRows(input));

    expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
    expect(body.message).toContain('중복');
  });

  it('age14를 consents 배열로 보내면 막는다 — 서버가 채우는 항목이라 두 번 남는다', () => {
    const input = {
      consents: [
        ...clientItems(),
        { document: ConsentDocument.AGE_14_OVER, version: V },
      ],
      ageConfirmed: true,
    };

    const body = expectThrownBody(() => buildConsentRows(input));

    expect(body.code).toBe(ErrorCode.CONSENT_INCOMPLETE);
    expect(body.message).toContain('서버가 채우는 항목');
  });

  it('빈 배열이면 필수 항목 전체를 누락으로 보고한다', () => {
    const body = expectThrownBody(() =>
      buildConsentRows({ consents: [], ageConfirmed: false }),
    );

    for (const doc of [
      ...CLIENT_CONSENT_DOCUMENTS,
      ConsentDocument.AGE_14_OVER,
    ]) {
      expect(body.message).toContain(doc);
    }
  });
});

describe('상수 표', () => {
  it('클라이언트 항목과 서버 항목은 겹치지 않는다', () => {
    const serverDocs = SERVER_CONSENT_ROWS.map((row) => row.document);
    expect(
      CLIENT_CONSENT_DOCUMENTS.filter((doc) => serverDocs.includes(doc)),
    ).toEqual([]);
  });

  it('서버가 채우는 항목은 저마다 형식이 유효한 version을 갖는다', () => {
    // 카테고리 하나에 상수를 공유하면 두 번째 항목이 엉뚱한 개정일로 적재되는데,
    // append-only라 사후 수정이 불가능하다. 항목별로 들고 있는지 여기서 못박는다.
    expect(SERVER_CONSENT_ROWS.length).toBeGreaterThan(0);
    for (const row of SERVER_CONSENT_ROWS) {
      expect(row.version).toMatch(CONSENT_VERSION_PATTERN);
    }
  });

  it('만 14세 확인은 최소연령 정책 버전으로 적재된다', () => {
    expect(SERVER_CONSENT_ROWS).toContainEqual({
      document: ConsentDocument.AGE_14_OVER,
      version: AGE_POLICY_VERSION,
    });
  });
});
