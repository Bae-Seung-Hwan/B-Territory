import { createHash } from 'crypto';
import { WithdrawalArchiveService } from './withdrawal-archive.service';
import { UserConsent } from '../consents/entities/user-consent.entity';
import { Report } from '../moderation/entities/report.entity';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';

const EMAIL = 'Gil.Dong@Example.com ';
const AGREED_AT = new Date('2026-09-08T01:02:03Z');

/** 저장된 소금으로 이메일을 다시 해싱한 값 — 서비스가 대조에 쓰는 것과 같은 방식. */
const rehash = (salt: string, email: string) =>
  createHash('sha256')
    .update(salt + email.trim().toLowerCase())
    .digest('hex');

describe('WithdrawalArchiveService', () => {
  /**
   * 트랜잭션 manager를 엔티티별 저장소로 흉내 낸다. 어느 표에 무엇이 들어갔는지를
   * 엔티티 단위로 봐야 "식별정보를 옮기지 않는다"를 검사할 수 있다.
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
    const withdrawalRepo = { find: jest.fn().mockResolvedValue(withdrawals) };
    const consentArchiveRepo = {
      find: jest.fn().mockResolvedValue(consentArchives),
    };
    const reportRepo = { find: jest.fn().mockResolvedValue(reports) };
    const service = new WithdrawalArchiveService(
      withdrawalRepo as never,
      consentArchiveRepo as never,
      reportRepo as never,
    );
    return { service, withdrawalRepo, consentArchiveRepo, reportRepo };
  }

  describe('archive', () => {
    const consentRows = [
      { document: 'service', version: '2026-09-08', agreedAt: AGREED_AT },
      { document: 'age14', version: '2026-09-07', agreedAt: AGREED_AT },
    ] as Partial<UserConsent>[];

    it('식별정보를 옮기지 않는다 — 남는 것은 소금과 해시뿐이다', async () => {
      const { service } = makeService();
      const { manager, saved, inserted } = makeManager(consentRows);

      await service.archive('user-1', EMAIL, manager as never);

      const [account] = saved;
      // 이메일·유저 id·닉네임 어느 것도 그대로 남으면 안 된다. 남으면 "탈퇴 시 지체 없이
      // 삭제"가 깨진다.
      expect(JSON.stringify(account)).not.toContain('user-1');
      expect(JSON.stringify(account).toLowerCase()).not.toContain('gil.dong');
      expect(account.subjectSalt).toHaveLength(32);
      expect(account.subjectHash).toBe(rehash(account.subjectSalt, EMAIL));

      // 동의 행에도 식별정보가 없다 — 연결은 가명 식별자 하나로만 이어진다.
      for (const row of inserted[0]) {
        expect(Object.keys(row).sort()).toEqual(
          ['agreedAt', 'document', 'version', 'withdrawalId'].sort(),
        );
      }
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

    it('피신고자였던 신고에 가명 식별자를 찍어 연결을 되살린다', async () => {
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

    it('탈퇴 건마다 소금이 달라 같은 이메일도 다른 해시가 된다', async () => {
      const { service } = makeService();
      const first = makeManager(consentRows);
      const second = makeManager(consentRows);

      await service.archive('user-1', EMAIL, first.manager as never);
      await service.archive('user-2', EMAIL, second.manager as never);

      // 같으면 이메일 목록을 통째로 대입해 표 전체를 역산할 수 있게 된다.
      expect(first.saved[0].subjectSalt).not.toBe(second.saved[0].subjectSalt);
      expect(first.saved[0].subjectHash).not.toBe(second.saved[0].subjectHash);
    });
  });

  describe('findByEmail', () => {
    const salt = 'a'.repeat(32);
    const stored = {
      id: 7,
      subjectSalt: salt,
      subjectHash: rehash(salt, EMAIL),
      withdrawnAt: AGREED_AT,
    };

    it('이메일을 제시하면 동의 사실과 신고 이력을 함께 돌려준다', async () => {
      const { service, consentArchiveRepo, reportRepo } = makeService(
        [{ id: 1, subjectSalt: 'b'.repeat(32), subjectHash: 'nope' }, stored],
        [{ document: 'service', version: '2026-09-08', agreedAt: AGREED_AT }],
        [{ id: 11, status: 'ACTIONED' } as Partial<Report>],
      );

      const found = await service.findByEmail(EMAIL);

      expect(found).not.toBeNull();
      expect(found?.consents).toEqual([
        { document: 'service', version: '2026-09-08', agreedAt: AGREED_AT },
      ]);
      expect(found?.reports).toHaveLength(1);
      // 두 조회 모두 가명 식별자로만 좁힌다.
      expect(consentArchiveRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { withdrawalId: 7 } }),
      );
      expect(reportRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { withdrawnTargetId: 7 } }),
      );
    });

    it('대소문자·공백이 달라도 같은 사람으로 찾는다', async () => {
      const { service } = makeService([stored]);

      await expect(
        service.findByEmail('  GIL.DONG@EXAMPLE.COM  '),
      ).resolves.not.toBeNull();
    });

    it('맞는 기록이 없으면 null이다 — 없는 사람을 만들어내지 않는다', async () => {
      const { service } = makeService([stored]);

      await expect(
        service.findByEmail('other@example.com'),
      ).resolves.toBeNull();
    });
  });
});
