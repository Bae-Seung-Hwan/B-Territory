import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WithdrawnAccount } from './withdrawn-account.entity';

/**
 * 탈퇴한 계정이 **무엇에 동의했었는지**. `user_consents`가 CASCADE로 사라지기 직전에 옮겨 둔다.
 *
 * 옮기는 것은 문서·개정일·동의 시각뿐이고, 누구의 것인지는 `withdrawnAccount`로 이어진다.
 * 보관 항목·기간은 개인정보처리방침 제3조 3항이 정한 것이라 여기서 임의로 넓히지 않는다.
 * 보존기간이 지나면 `withdrawn_accounts`가 지워지면서 FK CASCADE로 함께 파기된다.
 *
 * 원장(`user_consents`)과 달리 `agreedAt`에 기본값을 두지 않는다 — 여기 들어가는 값은
 * "이 행이 만들어진 시각"이 아니라 **원래 동의한 시각**이라, 기본값이 있으면 옮기다 빠뜨렸을
 * 때 탈퇴 시각이 동의 시각인 척 조용히 들어앉는다.
 */
@Entity('consent_archives')
// 이름을 명시하는 이유는 withdrawn-account.entity.ts 주석 참고.
@Index('IDX_consent_archives_withdrawal', ['withdrawalId'])
export class ConsentArchive {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  withdrawalId: number;

  @ManyToOne(() => WithdrawnAccount, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'withdrawalId',
    foreignKeyConstraintName: 'FK_consent_archives_withdrawal',
  })
  withdrawnAccount: WithdrawnAccount;

  /** 동의 항목 식별자(`ConsentDocument`). 원장과 같은 이유로 varchar다. */
  @Column({ type: 'varchar', length: 20 })
  document: string;

  /** 동의한 문서의 개정일. 어느 버전에 동의했는지가 남아야 증거로 쓸 수 있다. */
  @Column({ type: 'varchar', length: 20 })
  version: string;

  /** 원장에 있던 동의 시각을 그대로 옮긴다. */
  @Column({ type: 'timestamptz' })
  agreedAt: Date;
}
