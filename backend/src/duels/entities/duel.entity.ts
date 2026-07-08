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

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
