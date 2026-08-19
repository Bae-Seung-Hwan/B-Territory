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

/**
 * 관광지 리뷰(별점 미션). append-only — 하루 1회 게이트(Redis)로 스팸을 막고,
 * 같은 유저가 다른 날 다시 남긴 리뷰는 이력으로 함께 보관한다.
 */
@Entity('reviews')
@Index(['spotId', 'createdAt']) // 관광지별 최신순 목록 조회
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  // 유저 탈퇴(hard-delete) 후에도 리뷰 행은 남긴다 — 지우면 다른 유저들이 보는 관광지
  // 평균 별점·리뷰 수가 조용히 바뀐다. team을 비정규화해 두므로 userId가 NULL이 되어도
  // 팀 표시는 보존된다(score_events·spot_claims와 동일한 SET NULL 패턴).
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  // 작성 시점 팀 비정규화 (집계/표시 시 users 조인 없이 사용).
  @Column({ length: 2 })
  team: string;

  @Column({ type: 'int' })
  spotId: number;

  // spots가 지워지면 함께 지운다(score_events의 SET NULL과 의도적으로 다름).
  // 원장(score_events)은 유저·팀 단위로 집계하며 spotId는 출처 표시라 NULL이어도 행이 살아
  // 있어야 하지만, 이 테이블은 오직 스팟별로만 조회된다(listReviews의 WHERE spotId = :spotId).
  // spotId를 NULL로 남기면 어떤 쿼리로도 닿을 수 없는 죽은 행이 될 뿐이다.
  // 대신 스팟이 함부로 지워지지 않도록 seed-spots-csv.ts의 삭제 조건이 이 테이블을 확인한다.
  @ManyToOne(() => Spot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spotId' })
  spot: Spot;

  /** 별점 1~5 */
  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
