import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 주간 수도 지정 이력 — append-only. 매주 월요일 00:00 KST 배치가 등록된 구 하나를
 * 무작위로 뽑아 1행씩 적재한다. 가장 최근(designatedAt DESC) 행의 구가 이번 주 수도이며,
 * 해당 구에서 점령하는 모든 팀의 점수(개인·팀)에 CAPITAL_MULTIPLIER를 곱한다.
 * 행은 절대 수정/삭제하지 않는다(과거 어느 주에 어느 구가 수도였는지 감사용 소스).
 */
@Entity('capital_designations')
@Index(['designatedAt'])
export class CapitalDesignation {
  @PrimaryGeneratedColumn()
  id: number;

  // spots.sigungucode(문자열)와 조인하는 districts.sigunguCode와 동일 포맷.
  @Column()
  sigunguCode: string;

  // district_claim_history.capturedAt과 동일하게 timestamptz로 저장 — 최신 지정 판정이
  // DB 세션 타임존과 무관하게 절대 시각을 보존하도록 한다.
  @CreateDateColumn({ type: 'timestamptz' })
  designatedAt: Date;
}
