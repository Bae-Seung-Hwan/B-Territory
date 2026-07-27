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

  // 판정 기준: 최근 12시간 윈도우 동안 이 구에서 해당 팀이 획득한 팀 점수 합계
  @Column()
  teamScore: number;

  @UpdateDateColumn()
  calculatedAt: Date;
}
