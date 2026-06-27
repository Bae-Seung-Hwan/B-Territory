import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('spot_claims')
export class SpotClaim {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  spotId: number;

  @Column({ length: 2 })
  team: string;

  @Column('uuid')
  userId: string;

  @UpdateDateColumn()
  claimedAt: Date;
}
