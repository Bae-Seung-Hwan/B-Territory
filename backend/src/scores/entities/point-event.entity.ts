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

/** 포인트 획득 경로 — 결투는 포인트를 지급하지 않는다 (2026-07-16 기획 확정) */
export enum PointSource {
  CLAIM = 'CLAIM', // 관광지 점령
  IAP = 'IAP', // 인앱 결제 (현질)
  AD = 'AD', // 광고 시청
}

/**
 * 포인트 이벤트 원장 (append-only). 점수(score, 경쟁용)와 별개의 소비성 재화.
 * 잔액 = SUM(amount) — 이후 소비 기능은 음수 amount 이벤트로 기록한다.
 * IAP 기록은 결제 분쟁 대응을 위해 유저 탈퇴 후에도 보존한다 (SET NULL).
 */
@Entity('point_events')
@Index(['userId', 'createdAt'])
// 동일 근거(영수증/트랜잭션 ID 등)의 이벤트 재전송을 DB 레벨에서 차단 (refId 없는 이벤트는 제외).
// CLAIM은 제외한다 — refId가 spotId 그대로라 같은 관광지 재점령(상대팀 탈환, 재방문)마다
// 매번 새 이벤트가 쌓여야 하는데, 이 유니크 제약이 있으면 두 번째 점령부터 포인트가
// 영구히 막힌다. claim_score_events와 마찬가지로 idempotency key가 확정되면 별도 제약을 추가한다.
@Index('UQ_point_events_source_ref_id', ['source', 'refId'], {
  unique: true,
  where: '"refId" IS NOT NULL AND source != \'CLAIM\'',
})
export class PointEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: PointSource })
  source: PointSource;

  @Column({ type: 'int' })
  amount: number;

  // 근거 참조 — CLAIM: spotId, IAP: 스토어 영수증/주문 ID, AD: 광고 네트워크 트랜잭션 ID
  @Column({ type: 'varchar', nullable: true })
  refId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
