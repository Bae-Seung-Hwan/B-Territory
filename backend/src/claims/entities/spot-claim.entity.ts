import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Spot } from '../../spots/entities/spot.entity';
import { User } from '../../users/entities/user.entity';

@Entity('spot_claims')
export class SpotClaim {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  spotId: number;

  @ManyToOne(() => Spot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spotId' })
  spot: Spot;

  @Column({ length: 2 })
  team: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @UpdateDateColumn()
  claimedAt: Date;
}
