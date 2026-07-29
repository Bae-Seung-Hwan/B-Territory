import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 구 점령 이력 — append-only. 배치 집계가 실행될 때마다 현재 보유 중인 모든 구의
 * (팀, 팀점수) 스냅샷을 1행씩 적재한다. 6주차 명예의 전당이 "언제 어느 팀이 어느 구를
 * 몇 점으로 보유했는지" 시계열로 조회하는 데이터 소스. 행은 절대 수정/삭제하지 않는다.
 */
@Entity('district_claim_history')
@Index(['capturedAt'])
@Index(['sigungucode', 'capturedAt'])
export class DistrictClaimHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sigungucode: string;

  @Column({ length: 2 })
  team: string;

  @Column()
  teamScore: number;

  // score_events.createdAt과 동일하게 timestamptz로 저장 — 명예의 전당 시계열이 DB 세션
  // 타임존과 무관하게 절대 시각을 보존하도록 한다.
  @CreateDateColumn({ type: 'timestamptz' })
  capturedAt: Date;
}
