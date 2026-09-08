import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 탈퇴한 계정의 **가명 식별자**. 탈퇴 후에도 남는 기록들을 한 사람 것으로 묶는 고리다.
 *
 * 탈퇴하면 `users` 행이 하드 삭제되고, 그 순간 남아 있던 기록들의 연결이 전부 끊긴다 —
 * `user_consents`는 CASCADE로 통째로 사라지고, `reports`는 FK가 SET NULL이라 접수 기록은
 * 남지만 **누구에 대한 것인지**를 잃는다. 그래서 분쟁이 탈퇴 이후에 불거지는 가장 흔한
 * 경우(제재에 불복해 탈퇴한 뒤 이의제기)에 양쪽 다 증거로 쓰이지 못했다.
 *
 * 그렇다고 탈퇴자의 식별정보를 그대로 옮겨 두면 개인정보처리방침 제3조의 "탈퇴 시 지체 없이
 * 삭제"를 정면으로 깬다. 그래서 **누구인지는 저장하지 않고, 물어보면 확인만 되는** 형태로
 * 남긴다.
 *
 * - 이메일·닉네임·`users.id` 어느 것도 두지 않는다. 남는 식별 정보는 `subjectHash` 하나이고,
 *   그것도 이메일 자체가 아니라 **탈퇴 건마다 새로 뽑은 소금과 함께 해싱한 값**이다.
 * - 소금이 건마다 다르므로 이메일 목록을 통째로 대입해 표를 역산하는 일이 성립하지 않는다.
 *   이의를 제기한 사람이 자기 이메일을 제시했을 때에 한해 행별 소금으로 다시 해싱해 대조하면
 *   그 사람의 기록을 찾을 수 있다(`WithdrawalArchiveService.findByEmail`).
 * - 이메일을 고른 것은 **탈퇴자가 스스로 제시할 수 있는 유일한 값**이어서다. Firebase UID나
 *   `users.id`는 본인도 모르므로 대조에 쓸 수 없다.
 */
@Entity('withdrawn_accounts')
// 대조는 소금 때문에 전수 스캔이지만, 해시가 정해진 뒤 그 사람의 기록을 모으는 조회가
// 뒤따른다. 이름을 명시하는 것은 이 저장소 규칙이다 — 생략하면 TypeORM이 해시 이름을
// 만들어 마이그레이션 파일과 어긋나고 CI의 마이그레이션 정합성 검사가 깨진다.
@Index('IDX_withdrawn_accounts_subject', ['subjectHash'])
export class WithdrawnAccount {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * `sha256(subjectSalt + 소문자로 정규화한 이메일)`의 16진 표현.
   * 이 값만으로는 누구인지 알 수 없고, 이메일을 제시받았을 때 대조에만 쓴다.
   */
  @Column({ type: 'varchar', length: 64 })
  subjectHash: string;

  /** 탈퇴 건마다 새로 뽑는 16바이트 난수(16진). */
  @Column({ type: 'varchar', length: 32 })
  subjectSalt: string;

  @CreateDateColumn({ type: 'timestamptz' })
  withdrawnAt: Date;
}
