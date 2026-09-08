import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserConsent } from '../consents/entities/user-consent.entity';
import { Report } from '../moderation/entities/report.entity';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';

/** 이의제기에 답할 때 필요한 한 사람 분의 기록. */
export interface WithdrawalRecord {
  withdrawnAt: Date;
  /** 어느 문서의 어느 버전에 언제 동의했는지. */
  consents: { document: string; version: string; agreedAt: Date }[];
  /** 이 사람을 대상으로 접수됐던 신고와 그 처리 상태(제재 여부). */
  reports: Report[];
}

/**
 * 탈퇴 시 **남겨야 하는 것만** 가명으로 옮기고, 나중에 본인이 물어보면 찾아 주는 경로.
 *
 * 남기는 것은 셋뿐이다 — 계정 식별자(가명), 약관 동의 사실, 신고·제재 이력. 닉네임·이메일·
 * 위치·점령 기록 등 나머지는 기존대로 지워지거나 참조가 끊긴 채 남는다.
 *
 * 이 셋인 이유는 전부 **탈퇴 이후에 다툼이 생기는 지점**이라서다. 동의는 "받고 가입시켰다"를
 * 입증해야 하고, 신고·제재는 이의제기의 대상 그 자체이며, 둘을 한 사람 것으로 묶으려면
 * 식별자가 있어야 한다. 그 식별자를 실명값으로 두지 않는 이유는 `WithdrawnAccount` 참고.
 *
 * AccountService와 같은 모듈에 둔다 — consents와 moderation 두 도메인에 걸쳐 있어 어느 한쪽
 * 모듈에 넣으면 그 모듈이 다른 쪽을 참조하게 되고, 탈퇴가 이미 도메인 횡단 작업이라 이 모듈로
 * 올린다는 것이 AccountModule의 원래 취지다.
 */
@Injectable()
export class WithdrawalArchiveService {
  constructor(
    @InjectRepository(WithdrawnAccount)
    private readonly withdrawals: Repository<WithdrawnAccount>,
    @InjectRepository(ConsentArchive)
    private readonly consentArchives: Repository<ConsentArchive>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
  ) {}

  /**
   * 탈퇴 직전에 부른다. **반드시 `users` 행을 지우기 전에, 같은 트랜잭션으로** 불러야 한다 —
   * 삭제가 먼저면 `user_consents`는 CASCADE로 이미 사라졌고 `reports.targetUserId`는 NULL이
   * 되어 옮길 대상을 찾을 수 없다. 따로 커밋해도 안 된다: 그 사이에 죽으면 계정만 사라지고
   * 기록은 없는, 이 표가 막으려던 상태가 그대로 남는다.
   */
  async archive(
    userId: string,
    email: string,
    manager: EntityManager,
  ): Promise<WithdrawnAccount> {
    const subjectSalt = randomBytes(16).toString('hex');
    const withdrawal = await manager.getRepository(WithdrawnAccount).save({
      subjectSalt,
      subjectHash: hashSubject(subjectSalt, email),
    });

    const consents = await manager
      .getRepository(UserConsent)
      .find({ where: { userId } });
    if (consents.length > 0) {
      await manager.getRepository(ConsentArchive).insert(
        consents.map((row) => ({
          withdrawalId: withdrawal.id,
          document: row.document,
          version: row.version,
          agreedAt: row.agreedAt,
        })),
      );
    }

    // 신고 기록 자체는 FK가 SET NULL이라 그대로 남는다. 여기서 하는 일은 그 행들이 누구에
    // 대한 것이었는지의 연결을 가명으로 되살리는 것뿐이다. UPDATE는 users 행이 지워지기
    // 전에 돌아야 한다 — 지워진 뒤에는 targetUserId가 이미 NULL이라 대상을 못 고른다.
    await manager
      .getRepository(Report)
      .update({ targetUserId: userId }, { withdrawnTargetId: withdrawal.id });

    return withdrawal;
  }

  /**
   * 이메일을 제시받아 그 사람의 보관 기록을 찾는다. 탈퇴 후 이의제기에 답하는 경로다.
   *
   * 소금이 탈퇴 건마다 달라 인덱스로 좁힐 수 없고 **전수 대조**가 된다. 탈퇴 건수 규모에서는
   * 문제되지 않으며, 오히려 그 비용이야말로 이 표를 명단으로 역산하지 못하게 만드는 성질이다.
   *
   * HTTP로 열지 않는다 — 이메일만 넣으면 가입·제재 이력이 드러나는 조회라, 공개되는 순간
   * 특정인의 탈퇴 여부를 캐는 도구가 된다. 운영자가 필요할 때 쓰는 내부 경로로 둔다.
   */
  async findByEmail(email: string): Promise<WithdrawalRecord | null> {
    const candidates = await this.withdrawals.find();
    const matched = candidates.find(
      (row) => hashSubject(row.subjectSalt, email) === row.subjectHash,
    );
    if (!matched) return null;

    const [consents, reports] = await Promise.all([
      this.consentArchives.find({
        where: { withdrawalId: matched.id },
        order: { id: 'ASC' },
      }),
      this.reports.find({
        where: { withdrawnTargetId: matched.id },
        order: { createdAt: 'ASC' },
      }),
    ]);

    return {
      withdrawnAt: matched.withdrawnAt,
      consents: consents.map(({ document, version, agreedAt }) => ({
        document,
        version,
        agreedAt,
      })),
      reports,
    };
  }
}

/**
 * 보관 표의 주체 해시. 이메일은 대소문자와 앞뒤 공백이 실제로 섞여 들어오므로, 저장할 때와
 * 찾을 때 같은 방식으로 정규화해야 나중에 대조가 빗나가지 않는다.
 */
function hashSubject(salt: string, email: string): string {
  return createHash('sha256')
    .update(salt + email.trim().toLowerCase())
    .digest('hex');
}
