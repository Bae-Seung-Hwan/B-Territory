import { WithdrawalArchiveService } from './withdrawal-archive.service';
import { UserConsent } from '../consents/entities/user-consent.entity';
import { Report } from '../moderation/entities/report.entity';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';
import { WITHDRAWAL_RETENTION_INTERVAL } from './constants';

const EMAIL = ' Gil.Dong@Example.com ';
const NORMALIZED = 'gil.dong@example.com';
const AGREED_AT = new Date('2026-09-08T01:02:03Z');

describe('WithdrawalArchiveService', () => {
  /**
   * 트랜잭션 manager를 엔티티별 저장소로 흉내 낸다. 어느 표에 무엇이 들어갔는지를 엔티티
   * 단위로 봐야 "보관 항목이 조항 범위를 넘지 않는다"를 검사할 수 있다.
   */
  function makeManager(consents: Partial<UserConsent>[]) {
    const saved: WithdrawnAccount[] = [];
    const inserted: Partial<ConsentArchive>[][] = [];
    const updates: [unknown, unknown][] = [];
    const repos = new Map<unknown, unknown>([
      [
        WithdrawnAccount,
        {
          save: jest.fn((row: WithdrawnAccount) => {
            const withRow = { id: 7, withdrawnAt: new Date(), ...row };
            saved.push(withRow);
            return Promise.resolve(withRow);
          }),
        },
      ],
      [UserConsent, { find: jest.fn().mockResolvedValue(consents) }],
      [
        ConsentArchive,
        {
          insert: jest.fn((rows: Partial<ConsentArchive>[]) => {
            inserted.push(rows);
            return Promise.resolve(undefined);
          }),
        },
      ],
      [
        Report,
        {
          update: jest.fn((where: unknown, patch: unknown) => {
            updates.push([where, patch]);
            return Promise.resolve({ affected: 1 });
          }),
        },
      ],
    ]);
    const manager = { getRepository: jest.fn((e: unknown) => repos.get(e)) };
    return { manager, saved, inserted, updates };
  }

  function makeService(
    withdrawals: Partial<WithdrawnAccount>[] = [],
    consentArchives: Partial<ConsentArchive>[] = [],
    reports: Partial<Report>[] = [],
  ) {
    const execute = jest.fn().mockResolvedValue({ affected: 3 });
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const withdrawalRepo = {
      find: jest.fn().mockResolvedValue(withdrawals),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
      createQueryBuilder: jest.fn(() => ({ delete: del })),
    };
    const consentArchiveRepo = {
      find: jest.fn().mockResolvedValue(consentArchives),
    };
    const reportRepo = { find: jest.fn().mockResolvedValue(reports) };
    const service = new WithdrawalArchiveService(
      withdrawalRepo as never,
      consentArchiveRepo as never,
      reportRepo as never,
    );
    return { service, withdrawalRepo, consentArchiveRepo, reportRepo, where };
  }

  describe('archive', () => {
    const consentRows = [
      { document: 'service', version: '2026-09-08', agreedAt: AGREED_AT },
      { document: 'age14', version: '2026-09-07', agreedAt: AGREED_AT },
    ] as Partial<UserConsent>[];

    it('보관 항목은 이메일뿐이다 — 조항이 정한 범위를 넘지 않는다', async () => {
      const { service } = makeService();
      const { manager, saved, inserted } = makeManager(consentRows);

      await service.archive('user-1', EMAIL, manager as never);

      const [account] = saved;
      // 방침 제3조 3항이 "특정하기 위한 이메일 주소"만 적었다. userId·닉네임까지 옮기면
      // 그 조항을 넘어선다.
      expect(account.email).toBe(NORMALIZED);
      expect(JSON.stringify(account)).not.toContain('user-1');

      // 동의 행에도 식별정보가 없다 — 연결은 보관 건 참조 하나로만 이어진다.
      for (const row of inserted[0]) {
        expect(Object.keys(row).sort()).toEqual(
          ['agreedAt', 'document', 'version', 'withdrawalId'].sort(),
        );
      }
    });

    it('이메일을 정규화해 저장한다 — 나중 대조가 표기 차이로 빗나가지 않도록', async () => {
      const { service } = makeService();
      const { manager, saved } = makeManager(consentRows);

      await service.archive('user-1', EMAIL, manager as never);

      expect(saved[0].email).toBe(NORMALIZED);
    });

    it('문서·개정일·동의 시각을 그대로 옮긴다', async () => {
      const { service } = makeService();
      const { manager, inserted } = makeManager(consentRows);

      await service.archive('user-1', EMAIL, manager as never);

      expect(inserted[0]).toEqual([
        {
          withdrawalId: 7,
          document: 'service',
          version: '2026-09-08',
          agreedAt: AGREED_AT,
        },
        {
          withdrawalId: 7,
          document: 'age14',
          version: '2026-09-07',
          agreedAt: AGREED_AT,
        },
      ]);
    });

    it('피신고자였던 신고에 보관 건을 찍어 연결을 되살린다', async () => {
      const { service } = makeService();
      const { manager, updates } = makeManager(consentRows);

      await service.archive('user-1', EMAIL, manager as never);

      // 신고자(reporterId)는 건드리지 않는다 — SET NULL이 일부러 끊어 둔 "누가 신고했는지"를
      // 되살리는 일이 되기 때문이다.
      expect(updates).toEqual([
        [{ targetUserId: 'user-1' }, { withdrawnTargetId: 7 }],
      ]);
    });

    it('동의 이력이 없어도 계정 식별자와 신고 연결은 남긴다', async () => {
      // 이 표들이 생기기 전 가입자는 동의 원장이 비어 있다. 그렇다고 통째로 건너뛰면
      // 제재 이력이 있는 계정의 연결까지 함께 사라진다.
      const { service } = makeService();
      const { manager, saved, inserted, updates } = makeManager([]);

      await service.archive('user-1', EMAIL, manager as never);

      expect(saved).toHaveLength(1);
      expect(inserted).toEqual([]);
      expect(updates).toHaveLength(1);
    });
  });

  describe('findByEmail', () => {
    it('이메일을 제시하면 동의 사실과 신고 이력을 함께 돌려준다', async () => {
      const { service, withdrawalRepo, consentArchiveRepo, reportRepo } =
        makeService(
          [{ id: 7, email: NORMALIZED, withdrawnAt: AGREED_AT }],
          [{ document: 'service', version: '2026-09-08', agreedAt: AGREED_AT }],
          [{ id: 11 }],
        );

      const found = await service.findByEmail(EMAIL);

      // 표기가 달라도 같은 사람으로 찾도록 정규화한 값으로 조회한다.
      expect(withdrawalRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: NORMALIZED } }),
      );
      expect(found).toHaveLength(1);
      expect(found[0].consents).toEqual([
        { document: 'service', version: '2026-09-08', agreedAt: AGREED_AT },
      ]);
      expect(found[0].reports).toHaveLength(1);
      expect(consentArchiveRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { withdrawalId: 7 } }),
      );
      expect(reportRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { withdrawnTargetId: 7 } }),
      );
    });

    it('같은 주소로 여러 번 탈퇴했으면 전부 돌려준다', async () => {
      // 탈퇴 후 재가입해 다시 탈퇴하면 각각이 서로 다른 시점의 동의를 증명하는 별개의
      // 기록이다. 최근 것만 돌려주면 나머지가 조용히 가려진다.
      const { service } = makeService([
        { id: 8, email: NORMALIZED, withdrawnAt: new Date() },
        { id: 7, email: NORMALIZED, withdrawnAt: AGREED_AT },
      ]);

      await expect(service.findByEmail(EMAIL)).resolves.toHaveLength(2);
    });

    it('맞는 기록이 없으면 빈 배열이다 — 없는 사람을 만들어내지 않는다', async () => {
      const { service } = makeService([]);

      await expect(service.findByEmail('other@example.com')).resolves.toEqual(
        [],
      );
    });
  });

  describe('deleteByEmail', () => {
    it('파기 요구를 받은 이용자의 보관 건만 지운다', async () => {
      const { service, withdrawalRepo } = makeService();

      await expect(service.deleteByEmail(EMAIL)).resolves.toBe(2);

      // 저장할 때와 같은 정규화를 거쳐야 본인 기록을 찾는다.
      expect(withdrawalRepo.delete).toHaveBeenCalledWith({
        email: NORMALIZED,
      });
    });

    it('보존기간이 남아 있어도 지운다', async () => {
      // 보관의 근거가 증명 필요성이고, 본인이 그 증명을 포기하겠다고 하면 남길 이유가
      // 없어진다(방침 제7조 4항). 기간 조건을 걸면 요구를 이행하지 못한다.
      const { service, withdrawalRepo } = makeService();

      await service.deleteByEmail(EMAIL);

      const [where] = withdrawalRepo.delete.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(Object.keys(where)).toEqual(['email']);
    });
  });

  describe('purgeExpired', () => {
    it('보존기간이 지난 보관 건만 지운다', async () => {
      const { service, where } = makeService();

      await expect(service.purgeExpired()).resolves.toBe(3);

      // 방침 제3조 3항의 "보관 기간이 지나면 자동으로 파기" — 기간 안쪽 기록은 건드리지
      // 않는다. consent_archives는 FK CASCADE로, reports는 SET NULL로 함께 정리된다.
      expect(where).toHaveBeenCalledWith(expect.any(String), {
        interval: WITHDRAWAL_RETENTION_INTERVAL,
      });
    });
  });
});
