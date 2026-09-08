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
import { WithdrawnAccount } from '../../account/entities/withdrawn-account.entity';

export enum ReportReason {
  SPAM = 'SPAM',
  ABUSE = 'ABUSE',
  SEXUAL = 'SEXUAL',
  HATE = 'HATE',
  OTHER = 'OTHER',
}

export enum ReportStatus {
  PENDING = 'PENDING',
  REVIEWED = 'REVIEWED',
  ACTIONED = 'ACTIONED',
  DISMISSED = 'DISMISSED',
}

/**
 * 신고 접수 — Apple 심사 가이드라인 1.2(UGC)가 요구하는 "불쾌한 콘텐츠 신고 수단".
 *
 * 팀 채팅은 릴레이만 하고 메시지를 저장하지 않는다. 그래서 신고 시점에 클라이언트가 보낸
 * 메시지 원문을 이 테이블에 **스냅샷으로 복사해 둔다** — 저장된 원본이 없어 나중에 조회할
 * 방법이 없기 때문이다. 신고자가 임의로 조작할 수 있는 값이지만, 없으면 운영자가 무엇을
 * 신고당한 건지 알 수 없어 대응 자체가 불가능하다.
 *
 * 신고자·피신고자 FK는 SET NULL이다. 한쪽이 탈퇴해도 접수 기록과 스냅샷은 남아야
 * "적시 대응"의 근거가 된다(원장과 같은 성격).
 *
 * 다만 SET NULL은 **누구에 대한 신고였는지**까지 함께 끊는다. 제재에 불복해 탈퇴한 사람이
 * 나중에 이의를 제기하면 그 기록을 찾을 방법이 없었다. 그래서 피신고자가 탈퇴할 때
 * `withdrawnTargetId`에 보관 건을 가리키는 참조를 찍어 연결만 되살린다(`WithdrawnAccount`).
 * 그 보관 건이 보존기간(6개월)이 지나 파기되면 이 컬럼은 SET NULL로 다시 끊긴다 — 신고
 * 기록 자체는 방침 제3조 4항에 따라 계속 남되, 탈퇴자와의 연결만 사라지는 것이 맞다.
 * **신고자 쪽은 찍지 않는다** — 되살릴 이유가 없고, SET NULL이 일부러 끊어 둔 "누가
 * 신고했는지"를 되살리는 일이 되기 때문이다.
 */
// 인덱스·FK 이름을 명시하는 이유는 user-block.entity.ts 주석 참고.
@Entity('reports')
@Index('IDX_reports_target_createdAt', ['targetUserId', 'createdAt']) // 유저별 신고 누적
@Index('IDX_reports_status_createdAt', ['status', 'createdAt']) // 미처리 신고 큐
@Index('IDX_reports_withdrawn_target', ['withdrawnTargetId']) // 탈퇴자 이의제기 대응 조회
export class Report {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: true })
  reporterId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'reporterId',
    foreignKeyConstraintName: 'FK_reports_reporter',
  })
  reporter: User | null;

  @Column({ type: 'uuid', nullable: true })
  targetUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'targetUserId',
    foreignKeyConstraintName: 'FK_reports_target',
  })
  targetUser: User | null;

  // FK가 끊겨도 누구를 신고한 건지 남도록 닉네임을 비정규화해 둔다.
  // type을 명시해야 한다 — `string | null`은 emit되는 design:type이 Object라
  // TypeORM이 컬럼 타입을 추론하지 못하고 DataTypeNotSupportedError로 죽는다.
  @Column({ type: 'varchar', length: 50, nullable: true })
  targetNickname: string | null;

  @Column({ type: 'enum', enum: ReportReason })
  reason: ReportReason;

  // 신고 시점 메시지 스냅샷 (채팅은 저장되지 않으므로 이게 유일한 증거다)
  @Column({ type: 'text', nullable: true })
  contentSnapshot: string | null;

  // 신고자가 남기는 부연 설명
  @Column({ type: 'text', nullable: true })
  detail: string | null;

  /**
   * 피신고자가 탈퇴한 경우의 보관 건 참조. 탈퇴 시점에 채워지며 그 전에는 NULL이다
   * (탈퇴하지 않은 유저는 `targetUserId`가 살아 있어 필요 없다).
   */
  @Column({ type: 'int', nullable: true })
  withdrawnTargetId: number | null;

  @ManyToOne(() => WithdrawnAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'withdrawnTargetId',
    foreignKeyConstraintName: 'FK_reports_withdrawn_target',
  })
  withdrawnTarget: WithdrawnAccount | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
