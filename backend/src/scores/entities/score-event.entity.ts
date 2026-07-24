import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Spot } from '../../spots/entities/spot.entity';
import { Duel } from '../../duels/entities/duel.entity';

export enum ScoreEventType {
  CLAIM_NEW = 'CLAIM_NEW',
  CLAIM_REVISIT = 'CLAIM_REVISIT',
  DUEL_WIN = 'DUEL_WIN',
  DUEL_LOSS = 'DUEL_LOSS',
}

/**
 * 점수 원장 — append-only. 랭킹/시즌 집계는 전부 이 테이블의 SUM 쿼리로 산출하고,
 * 행 자체는 절대 수정/삭제하지 않는다 (감사 로그 겸용).
 * 팀 점수 집계 시에는 반드시 type IN (CLAIM_NEW, CLAIM_REVISIT)로 필터링할 것 —
 * 결투 점수(DUEL_WIN/DUEL_LOSS)는 개인 점수에만 반영되고 팀 점수에는 절대 포함되지 않는다.
 */
@Entity('score_events')
@Index(['team', 'createdAt'])
@Index(['userId', 'createdAt'])
export class ScoreEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  // 이벤트 시점의 팀을 그대로 남긴다 (집계 시 매번 users 테이블과 조인하지 않기 위한 비정규화).
  @Column({ length: 2 })
  team: string;

  @Column({ type: 'enum', enum: ScoreEventType })
  type: ScoreEventType;

  // 결투 패배는 음수가 될 수 있다.
  @Column({ type: 'int' })
  points: number;

  @Column({ nullable: true })
  spotId: number | null;

  @ManyToOne(() => Spot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'spotId' })
  spot: Spot | null;

  @Column({ nullable: true })
  duelId: number | null;

  @ManyToOne(() => Duel, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'duelId' })
  duel: Duel | null;

  @CreateDateColumn()
  createdAt: Date;
}
