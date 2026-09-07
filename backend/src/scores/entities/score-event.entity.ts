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
  // 결투 신청을 거절한 쪽의 소액 차감. 승패가 갈리지 않았으므로 상대에게 주는 점수는
  // 없고(원장 행도 거절자 한 줄뿐), 이 유출분만큼 개인 점수 총량이 줄어든다.
  DUEL_REJECT = 'DUEL_REJECT',
  // 응답 없이 만료된 신청에서 응답하지 않은 쪽의 차감. 금액은 DUEL_REJECT와 같지만,
  // "거절했다"와 "무시했다"는 운영상 구분되어야 해서 타입을 나눈다.
  DUEL_NO_RESPONSE = 'DUEL_NO_RESPONSE',
  // 미션 보너스 — 개인 점수에만 기여(teamPoints=0). 팀/영토 집계는 CLAIM_*만 계산하므로
  // 미션은 결투(DUEL_*)와 같이 개인 랭킹·user.score에만 반영된다.
  MISSION_PHOTO = 'MISSION_PHOTO',
  MISSION_REVIEW = 'MISSION_REVIEW',
}

/**
 * 점수 원장 — append-only. 랭킹/시즌 집계는 전부 이 테이블의 SUM 쿼리로 산출하고,
 * 행 자체는 절대 수정/삭제하지 않는다 (감사 로그 겸용).
 *
 * 점수는 개인/팀 두 축으로 분리 저장한다:
 * - personalPoints: user.score·개인 랭킹의 근거. 모든 이벤트가 기여하며 결투 패배·거절·무응답은 음수.
 * - teamPoints: 구 집계·팀 랭킹의 근거. 점령(CLAIM_*)만 값을 갖고, 결투 이벤트는 항상 0.
 *
 * 팀 점수 집계 시에는 반드시 SUM(teamPoints) + type IN (CLAIM_NEW, CLAIM_REVISIT)로 필터링할 것 —
 * 결투 점수(DUEL_* 전부)는 개인 점수에만 반영되고 팀 점수에는 절대 포함되지 않는다.
 */
@Entity('score_events')
@Index(['team', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['createdAt']) // 12시간 윈도우 구 집계용
export class ScoreEvent {
  @PrimaryGeneratedColumn()
  id: number;

  // 유저 탈퇴(hard-delete) 후에도 원장 행은 감사·팀 점수 근거로 남긴다. team을 비정규화해
  // 두므로 팀 집계는 userId가 NULL이 되어도 보존된다(spot_claims·#20 원장과 동일한 SET NULL 패턴).
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  // 이벤트 시점의 팀을 그대로 남긴다 (집계 시 매번 users 테이블과 조인하지 않기 위한 비정규화).
  @Column({ length: 2 })
  team: string;

  @Column({ type: 'enum', enum: ScoreEventType })
  type: ScoreEventType;

  // 개인 점수 기여분 (개인 랭킹·user.score). 결투 패배·거절·무응답은 음수가 될 수 있다.
  @Column({ type: 'int' })
  personalPoints: number;

  // 팀 점수 기여분 (구 집계·팀 랭킹). 결투 이벤트는 0.
  @Column({ type: 'int', default: 0 })
  teamPoints: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  spotId: number | null;

  @ManyToOne(() => Spot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'spotId' })
  spot: Spot | null;

  @Column({ type: 'int', nullable: true })
  duelId: number | null;

  @ManyToOne(() => Duel, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'duelId' })
  duel: Duel | null;

  // timestamptz로 저장해 절대 시각(인스턴트)을 보존한다. 일일 제한(KST 자정)·12시간 윈도우
  // 판정이 DB 세션 타임존 설정과 무관하게 정확히 동작하도록 하기 위함.
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
