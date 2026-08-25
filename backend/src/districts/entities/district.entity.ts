import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';

/**
 * 부산 16개 구·군 마스터 (data/busan_districts.csv 시딩).
 * scoreWeight는 시딩 시 foreign_visitor_share / (share 보유 구 평균)으로 계산해 저장하며,
 * 점령 점수 산정 시 이 값을 기본 점수에 곱한다. share가 없는 구는 1.0.
 * sigunguCode는 spots.sigungucode(문자열)와 조인하므로 varchar로 저장한다.
 */
@Entity('districts')
export class District {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  sigunguCode: string;

  @Column()
  nameKo: string;

  @Column()
  nameEn: string;

  @Column('decimal', {
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  centerLat: number | null;

  @Column('decimal', {
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  centerLng: number | null;

  @Column('decimal', {
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  foreignVisitorShare: number | null;

  @Column({ type: 'varchar', nullable: true })
  refPeriod: string | null;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'int', nullable: true })
  kmaNx: number | null;

  @Column({ type: 'int', nullable: true })
  kmaNy: number | null;

  // 점령 점수 가중치 (share / 평균share). share 없으면 1.0.
  @Column('decimal', {
    precision: 6,
    scale: 4,
    default: 1,
    transformer: numericTransformer,
  })
  scoreWeight: number;
}
