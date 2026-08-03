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

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 2 })
  team: string;

  @Column({ type: 'int' })
  spotId: number;

  @ManyToOne(() => Spot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spotId' })
  spot: Spot;

  @Column()
  imageUrl: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
