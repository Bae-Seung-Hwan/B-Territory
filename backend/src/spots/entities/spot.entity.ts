import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

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

  @Column('decimal', { precision: 13, scale: 10, nullable: true })
  mapX: number;

  @Column('decimal', { precision: 13, scale: 10, nullable: true })
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

  @Column({ nullable: true })
  usetime: string;

  @Column({ nullable: true })
  homepage: string;
}
