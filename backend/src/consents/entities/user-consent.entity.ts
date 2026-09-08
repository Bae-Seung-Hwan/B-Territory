import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * 가입 동의 이력 — "누가 어느 문서의 어느 버전에 언제 동의했는지"의 원장.
 *
 * 이 표가 생기기 전에는 동의를 화면에서 받기만 하고 **어디에도 남기지 않았다.** 그래서
 * (a) 동의 사실을 입증할 자료가 없었고, (b) 문서를 개정했을 때 누구에게 재동의를 받아야
 * 하는지 판단할 근거가 없었다(모든 이용자가 미상 버전이었다). `version`을 함께 남기는 것이
 * 이 표의 핵심이다 — 개정 시 이 값과 현재 문서 버전을 비교해 재동의 대상을 고른다.
 *
 * **append-only다.** 재동의는 기존 행을 갱신하지 않고 새 행을 추가한다. 동의 이력은 "지금
 * 유효한 상태"가 아니라 "그 시점에 무엇에 동의했는가"의 기록이라, 덮어쓰면 개정 전 동의를
 * 입증할 수단이 사라진다. 그래서 (userId, document)에 UNIQUE를 걸지 않는다.
 *
 * `location_usage_logs`와 달리 users FK를 걸고 ON DELETE CASCADE로 함께 지운다. 그쪽은
 * 위치정보법 제16조 2항이 6개월 보존을 **명령한** 법정 자료지만, 동의 이력에는 그런 명시적
 * 보존 의무가 확인되지 않았다. 탈퇴 후에도 남기면 개인정보처리방침 제3조가 약속한 "탈퇴 시
 * 식별정보 지체 없이 삭제"를 깨면서 탈퇴 후 잔존 항목이 하나 더 느는데, 그 대가를 치를
 * 법적 근거가 아직 없다. 보존기간은 법률 검토 항목으로 열려 있으며(docs/compliance.md 6장),
 * "남겨야 한다"로 결론이 나면 FK를 떼고 subjectId만 남기는 마이그레이션으로 전환한다 —
 * 반대 방향(이미 보관해 버린 것을 되돌리는 일)은 불가능하므로 지우는 쪽을 기본값으로 둔다.
 */
@Entity('user_consents')
// 재동의 판단은 "이 이용자가 이 문서에 동의한 이력"을 문서별로 훑는 질의라 복합 인덱스를 둔다.
// 이름을 명시하는 것은 이 저장소 규칙이다 — 생략하면 TypeORM이 해시 이름을 만들어
// 마이그레이션 파일과 어긋나고 CI의 마이그레이션 정합성 검사가 깨진다.
@Index('IDX_user_consents_user_document', ['userId', 'document'])
export class UserConsent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_user_consents_user',
  })
  user: User;

  /**
   * 동의 항목 식별자(`ConsentDocument`). enum 타입 컬럼이 아니라 varchar다 — 항목이 늘 때
   * 마이그레이션으로 DB 타입까지 바꾸지 않아도 되고, 과거 이력에는 지금 enum에 없는 값이
   * 남아 있어도 읽을 수 있어야 한다(항목을 없앤 뒤에도 그때의 동의는 유효한 기록이다).
   */
  @Column({ type: 'varchar', length: 20 })
  document: string;

  /** 동의한 문서의 개정일(YYYY-MM-DD). 프론트 `LegalDocument.version`이 그대로 온다. */
  @Column({ type: 'varchar', length: 20 })
  version: string;

  @CreateDateColumn({ type: 'timestamptz' })
  agreedAt: Date;
}
