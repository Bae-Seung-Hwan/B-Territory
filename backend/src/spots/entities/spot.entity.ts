import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';

@Entity('spots')
export class Spot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  contentId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  addr1: string;

  @Column('decimal', {
    precision: 13,
    scale: 10,
    nullable: true,
    transformer: numericTransformer,
  })
  mapX: number;

  @Column('decimal', {
    precision: 13,
    scale: 10,
    nullable: true,
    transformer: numericTransformer,
  })
  mapY: number;

  @Column({ nullable: true })
  firstimage: string;

  @Column({ nullable: true })
  contenttypeid: string;

  @Column({ nullable: true })
  areacode: string;

  @Column({ nullable: true })
  sigungucode: string;

  @Column({ type: 'text', nullable: true })
  overview: string;

  // 영문 설명. 영문 원본 데이터가 확보되면 채운다. 없으면 조회 시 한국어(overview)로 폴백한다.
  @Column({ type: 'text', nullable: true })
  overviewEn: string | null;

  @Column({ nullable: true })
  usetime: string;

  @Column({ nullable: true })
  homepage: string;
}
