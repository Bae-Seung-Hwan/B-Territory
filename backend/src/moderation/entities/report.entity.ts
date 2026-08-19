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
 */
@Entity('reports')
@Index(['targetUserId', 'createdAt']) // 특정 유저에 대한 신고 누적 조회
@Index(['status', 'createdAt']) // 미처리 신고 큐
export class Report {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: true })
  reporterId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reporterId' })
  reporter: User | null;

  @Column({ type: 'uuid', nullable: true })
  targetUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'targetUserId' })
  targetUser: User | null;

  // FK가 끊겨도 누구를 신고한 건지 남도록 닉네임을 비정규화해 둔다.
  @Column({ length: 50, nullable: true })
  targetNickname: string | null;

  @Column({ type: 'enum', enum: ReportReason })
  reason: ReportReason;

  // 신고 시점 메시지 스냅샷 (채팅은 저장되지 않으므로 이게 유일한 증거다)
  @Column({ type: 'text', nullable: true })
  contentSnapshot: string | null;

  // 신고자가 남기는 부연 설명
  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
