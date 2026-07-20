import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum DuelStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  COMPLETED = 'COMPLETED',
  VOID = 'VOID',
}

@Entity('duels')
export class Duel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  challengerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'challengerId' })
  challenger: User;

  @Column({ type: 'uuid' })
  opponentId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'opponentId' })
  opponent: User;

  @Column({ type: 'enum', enum: DuelStatus, default: DuelStatus.PENDING })
  status: DuelStatus;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  loserId: string | null;

  @Column({ type: 'int', nullable: true })
  scoreDelta: number | null;

  @Column({ type: 'boolean', default: false })
  allyBonusApplied: boolean;

  @CreateDateColumn()
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  /** 마지막 결과 신고 접수 시각 (DB 시계) — 신고 진행 중인 결투를 스윕이 VOID로 선점하지 않도록 유예 판단에 사용 */
  @Column({ type: 'timestamp', nullable: true })
  resultReportedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
