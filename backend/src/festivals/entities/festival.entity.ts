import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';

/**
 * TourAPI `searchFestival2`로 동기화하는 부산 축제.
 * contentId를 유니크 키로 upsert하고, 진행 상태는 eventStartDate/eventEndDate와
 * 조회 시점의 KST 날짜를 비교해 판정한다(별도 상태 컬럼을 두지 않는다).
 */
@Entity('festivals')
export class Festival {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  contentId: string;

  @Column()
  title: string;

  // nullable 컬럼은 타입도 | null로 선언한다 — TourAPI가 주지 않는 필드가 흔해 실제로 null이
  // 내려가는데, 선언이 non-nullable이면 소비자가 항상 값이 있다고 믿게 된다.
  //
  // 유니온 타입으로 선언할 때는 type을 반드시 명시해야 한다. TypeORM은 emitDecoratorMetadata의
  // design:type으로 컬럼 타입을 추론하는데, `string | null`은 Object로 반영되어
  // DataTypeNotSupportedError로 DataSource 초기화가 실패한다(부팅 불가).
  @Column({ type: 'varchar', nullable: true })
  addr1: string | null;

  @Column('decimal', {
    precision: 13,
    scale: 10,
    nullable: true,
    transformer: numericTransformer,
  })
  mapX: number | null;

  @Column('decimal', {
    precision: 13,
    scale: 10,
    nullable: true,
    transformer: numericTransformer,
  })
  mapY: number | null;

  @Column({ type: 'varchar', nullable: true })
  firstimage: string | null;

  @Column({ type: 'varchar', nullable: true })
  tel: string | null;

  // '아직 끝나지 않은 축제' 필터(eventEndDate 기준)와 '예정' 필터(eventStartDate 기준)를
  // 각각 덮도록 단일 컬럼 인덱스를 둔다. 복합 인덱스는 선행 컬럼만 쓰는 쿼리를 못 덮는다.
  /** 축제 시작일 (KST 기준 날짜). Postgres date로 저장돼 'YYYY-MM-DD'로 읽힌다. */
  @Index('IDX_festivals_start')
  @Column({ type: 'date' })
  eventStartDate: string;

  /** 축제 종료일 (KST 기준 날짜). */
  @Index('IDX_festivals_end')
  @Column({ type: 'date' })
  eventEndDate: string;

  @Column({ type: 'varchar', nullable: true })
  areacode: string | null;

  @Column({ type: 'varchar', nullable: true })
  sigungucode: string | null;

  // @UpdateDateColumn은 upsert의 ON CONFLICT UPDATE에 포함되지 않아 재동기화 시 갱신되지
  // 않는다. 동기화 시각을 정확히 남기려 일반 컬럼으로 두고 서비스에서 명시적으로 채운다.
  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
