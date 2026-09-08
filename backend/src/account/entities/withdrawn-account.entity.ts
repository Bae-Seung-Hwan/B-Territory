import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 탈퇴한 계정의 보관 항목 — 탈퇴 후에도 남는 기록들을 한 사람 것으로 묶는 고리다.
 *
 * 탈퇴하면 `users` 행이 하드 삭제되고, 그 순간 남아 있던 기록들의 연결이 전부 끊긴다 —
 * `user_consents`는 CASCADE로 통째로 사라지고, `reports`는 FK가 SET NULL이라 접수 기록은
 * 남지만 **누구에 대한 것인지**를 잃는다. 그래서 분쟁이 탈퇴 이후에 불거지는 가장 흔한
 * 경우(제재에 불복해 탈퇴한 뒤 이의제기)에 양쪽 다 증거로 쓰이지 못했다.
 *
 * **개인정보처리방침 제3조 3항이 이 표의 명세다.** 보관 항목·기간·목적·금지 용도가 조항으로
 * 확정돼 있으므로 여기서 임의로 넓히거나 좁히지 않는다. 특히 이메일 주소는 조항이 명시한
 * 항목이다 — "그 이력을 해당 이용자의 것으로 특정하기 위한" 값이고, **탈퇴자가 스스로
 * 제시할 수 있는 유일한 값**이기도 하다(Firebase UID나 `users.id`는 본인도 모른다).
 * 항목·기간·보관 위치를 바꾸려면 그 조항부터 고칠 것.
 *
 * 조항이 스스로 금지한 용도(탈퇴자 식별, 재가입 제한, 광고·통계)에 쓰지 않는다. 그래서
 * 서비스 코드에서 이 표를 조회하는 곳은 없고, 읽기 경로는 이의제기 대응용 내부 조회
 * (`WithdrawalArchiveService.findByEmail`) 하나뿐이며 HTTP로 열지 않는다.
 *
 * 보존기간은 6개월이고 `purge` 잡이 만료분을 지운다. 그때 `consent_archives`는 FK CASCADE로,
 * `reports.withdrawnTargetId`는 SET NULL로 함께 정리돼 "그 이후에는 서비스도 동의 사실을
 * 확인할 수 없습니다"(제3조 3항)가 실제로 성립한다.
 *
 * 이메일에 UNIQUE를 걸지 않는다 — 탈퇴 후 재가입해 다시 탈퇴하면 같은 주소로 두 건이
 * 쌓이고, 각각이 서로 다른 시점의 동의를 증명하는 별개의 기록이다.
 */
@Entity('withdrawn_accounts')
// 이의제기 대응은 이메일로 찾는 조회다. 이름을 명시하는 것은 이 저장소 규칙이다 —
// 생략하면 TypeORM이 해시 이름을 만들어 마이그레이션 파일과 어긋나고 CI의 마이그레이션
// 정합성 검사가 깨진다.
@Index('IDX_withdrawn_accounts_email', ['email'])
export class WithdrawnAccount {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * 탈퇴 시점의 이메일 주소. 대소문자·앞뒤 공백을 정규화해 저장한다 — 나중에 이용자가
   * 제시하는 표기가 가입 때와 다를 수 있어, 정규화하지 않으면 대조가 빗나간다.
   */
  @Column({ type: 'varchar' })
  email: string;

  @CreateDateColumn({ type: 'timestamptz' })
  withdrawnAt: Date;
}
