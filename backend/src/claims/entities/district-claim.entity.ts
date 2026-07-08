import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('district_claims')
export class DistrictClaim {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  sigungucode: string;

  @Column({ length: 2 })
  team: string;

  @Column()
  spotCount: number;

  @UpdateDateColumn()
  calculatedAt: Date;
}
