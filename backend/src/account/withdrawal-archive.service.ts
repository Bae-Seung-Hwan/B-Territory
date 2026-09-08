import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserConsent } from '../consents/entities/user-consent.entity';
import { Report } from '../moderation/entities/report.entity';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';
import { WITHDRAWAL_RETENTION_INTERVAL } from './constants';

/** 이의제기에 답할 때 필요한 탈퇴 한 건 분의 기록. */
export interface WithdrawalRecord {
  withdrawnAt: Date;
  /** 어느 문서의 어느 버전에 언제 동의했는지. */
  consents: { document: string; version: string; agreedAt: Date }[];
  /** 이 사람을 대상으로 접수됐던 신고와 그 처리 상태(제재 여부). */
  reports: Report[];
}

/**
 * 탈퇴 시 **남겨야 하는 것만** 옮기고, 나중에 본인이 물어보면 찾아 주고, 6개월 뒤 파기한다.
 *
 * 남기는 것은 셋뿐이다 — 계정 식별자(이메일), 약관 동의 사실, 신고·제재 연결. 닉네임·위치·
 * 점령 기록 등 나머지는 기존대로 지워지거나 참조가 끊긴 채 남는다. 이 범위와 6개월이라는
 * 기간은 **개인정보처리방침 제3조 3항이 정한 것**이므로 임의로 넓히지 않는다.
 *
 * 셋인 이유는 전부 **탈퇴 이후에 다툼이 생기는 지점**이라서다. 동의는 "받고 가입시켰다"를
 * 입증해야 하고, 신고·제재는 이의제기의 대상 그 자체이며, 둘을 한 사람 것으로 묶으려면
 * 식별자가 있어야 한다.
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
    const withdrawal = await manager
      .getRepository(WithdrawnAccount)
      .save({ email: normalizeEmail(email) });

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
    // 대한 것이었는지의 연결을 되살리는 것뿐이다. UPDATE는 users 행이 지워지기 전에 돌아야
    // 한다 — 지워진 뒤에는 targetUserId가 이미 NULL이라 대상을 못 고른다.
    await manager
      .getRepository(Report)
      .update({ targetUserId: userId }, { withdrawnTargetId: withdrawal.id });

    return withdrawal;
  }

  /**
   * 이메일로 그 사람의 보관 기록을 찾는다. 탈퇴 후 이의제기에 답하는 경로다.
   *
   * 한 주소로 여러 건이 나올 수 있다 — 탈퇴 후 재가입해 다시 탈퇴하면 각각이 서로 다른
   * 시점의 동의를 증명하는 별개의 기록이라, 최근 것만 돌려주면 나머지가 조용히 가려진다.
   * 최신순으로 전부 돌려준다.
   *
   * HTTP로 열지 않는다 — 이메일만 넣으면 가입·제재 이력이 드러나는 조회라, 공개되는 순간
   * 특정인의 탈퇴 여부를 캐는 도구가 된다. 방침 제3조 3항이 금지한 용도(탈퇴자 식별,
   * 재가입 제한)와 맞닿아 있으므로 운영자가 필요할 때 쓰는 내부 경로로 둔다.
   */
  async findByEmail(email: string): Promise<WithdrawalRecord[]> {
    const matched = await this.withdrawals.find({
      where: { email: normalizeEmail(email) },
      order: { withdrawnAt: 'DESC', id: 'DESC' },
    });

    return Promise.all(
      matched.map(async (withdrawal) => {
        const [consents, reports] = await Promise.all([
          this.consentArchives.find({
            where: { withdrawalId: withdrawal.id },
            order: { id: 'ASC' },
          }),
          this.reports.find({
            where: { withdrawnTargetId: withdrawal.id },
            order: { createdAt: 'ASC' },
          }),
        ]);
        return {
          withdrawnAt: withdrawal.withdrawnAt,
          consents: consents.map(({ document, version, agreedAt }) => ({
            document,
            version,
            agreedAt,
          })),
          reports,
        };
      }),
    );
  }

  /**
   * 이용자가 파기를 요구했을 때 그 사람의 보관 건을 지운다(방침 제7조 4항).
   *
   * 보존기간이 남아 있어도 지운다 — 보관의 근거가 증명 필요성이고, 본인이 그 증명을
   * 포기하겠다고 하면 남길 이유가 없어진다. **그래서 이후로는 그 이용자에게 동의를 받았다는
   * 사실을 증명할 수 없다.** 조항도 그 점을 함께 안내하도록 적혀 있으므로, 요구를 접수할 때
   * 반드시 알린 뒤 실행할 것.
   *
   * `purgeExpired`와 같은 이유로 `withdrawn_accounts`만 지우면 된다 — 동의 행은 FK CASCADE로,
   * 신고 연결은 SET NULL로 함께 정리된다. 신고 기록 자체는 방침 제3조 4항의 별개 항목이라
   * 파기 요구 대상이 아니다.
   */
  async deleteByEmail(email: string): Promise<number> {
    const result = await this.withdrawals.delete({
      email: normalizeEmail(email),
    });
    return result.affected ?? 0;
  }

  /**
   * 보존기간(6개월)이 지난 보관 건을 파기한다. 방침 제3조 3항의 "보관 기간이 지나면 자동으로
   * 파기하며, 그 이후에는 서비스도 동의 사실을 확인할 수 없습니다"를 실제로 성립시키는 잡이다.
   *
   * `withdrawn_accounts`만 지우면 된다 — `consent_archives`는 FK CASCADE로 함께 사라지고,
   * `reports.withdrawnTargetId`는 SET NULL이라 신고 기록은 남되 연결만 끊긴다. 신고 기록
   * 자체는 방침 제3조 4항에 따라 계속 보관되는 별개의 항목이므로 여기서 손대지 않는다.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.withdrawals
      .createQueryBuilder()
      .delete()
      .where('"withdrawnAt" < now() - CAST(:interval AS interval)', {
        interval: WITHDRAWAL_RETENTION_INTERVAL,
      })
      .execute();
    return result.affected ?? 0;
  }
}

/**
 * 저장할 때와 찾을 때 같은 방식으로 정규화한다. 이용자가 나중에 제시하는 표기가 가입 때와
 * 다를 수 있어(대문자, 앞뒤 공백) 정규화하지 않으면 본인 기록을 못 찾는다.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
