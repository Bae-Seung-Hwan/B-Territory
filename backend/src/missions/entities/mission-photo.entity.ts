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
 * 현장 사진 인증 미션 기록. S3에 올린 이미지의 URL만 저장한다.
 * append-only — 하루 1회 게이트(Redis)로 인당 관광지별 1건/일로 제한한다.
 */
@Entity('mission_photos')
@Index(['spotId', 'createdAt']) // 관광지별 최신순 조회
export class MissionPhoto {
  @PrimaryGeneratedColumn()
  id: number;

  // 유저 탈퇴(hard-delete) 후에도 사진 기록은 남긴다 — 이 행위로 지급된 score_events는
  // SET NULL로 보존되므로, 증빙만 사라지면 원장과 어긋난다.
  // team을 비정규화해 두므로 userId가 NULL이 되어도 팀 표시는 보존된다.
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

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

  @Column()
  imageUrl: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
