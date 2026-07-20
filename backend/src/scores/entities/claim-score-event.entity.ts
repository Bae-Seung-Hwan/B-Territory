import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Spot } from '../../spots/entities/spot.entity';
import { User } from '../../users/entities/user.entity';

/**
 * 점령 점수 이벤트 원장 (append-only).
 *
 * 팀 점수 = 시즌 기간(createdAt 필터)으로 SUM(score) GROUP BY team — 별도 집계
 * 컬럼을 두지 않아 시즌(3개월) 리셋 작업이 필요 없고, 지난 시즌 기록이 랭킹·칭호
 * 산출과 어뷰징 감사에 그대로 남는다.
 *
 * 결투 점수(User.score)는 개인 점수 전용으로 팀 점수에 포함되지 않으므로
 * 이 원장에 절대 기록하지 않는다 (2026-07-16 기획 확정).
 *
 * 중복 이벤트 방지용 유니크 제약은 아직 없다 — spot_claims는 점령 시점마다 claimedAt이
 * 갱신되는 현재 상태 테이블이라, 이 원장의 특정 행을 어느 점령 발생과 매칭할지(idempotency
 * key)는 점수 지급 서비스(후속 PR)가 확정한 뒤에 추가한다.
 */
@Entity('claim_score_events')
// 시즌 팀 점수 합산 (WHERE createdAt BETWEEN ... GROUP BY team)
@Index(['team', 'createdAt'])
// 개인 시즌 점수·일일 획득 수 조회
@Index(['userId', 'createdAt'])
export class ClaimScoreEvent {
  @PrimaryGeneratedColumn()
  id: number;

  // 유저 탈퇴 후에도 팀 점수가 보존되도록 SET NULL + team 비정규화 유지
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  // 획득 시점의 팀 스냅샷 — 유저의 현재 팀이 아니라 이 값으로 합산한다
  @Column({ length: 2 })
  team: string;

  // 관광지가 CSV에서 제거되어도 점수 기록은 남긴다
  @Column({ type: 'int', nullable: true })
  spotId: number | null;

  @ManyToOne(() => Spot, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'spotId' })
  spot: Spot;

  // 가중치 적용 후 최종 점수 (기준 점령치 × 관광지 가중치 — 산정 시점에 확정값 저장)
  @Column({ type: 'int' })
  score: number;

  @CreateDateColumn()
  createdAt: Date;
}
