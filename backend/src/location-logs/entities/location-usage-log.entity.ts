import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 위치정보 이용·제공사실 확인자료 —
 * 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 이용자의 위치정보를
 * 전송받을 때마다 자동으로 기록·보존해야 하는 법정 원장이다.
 *
 * 신고서 양식이 요구하는 항목과 컬럼이 1:1로 대응한다:
 *   대상       → subjectId       (개인위치정보주체를 식별할 수 있는 값)
 *   취득경로   → acquisitionPath (위치정보를 취득하게 된 경로)
 *   제공서비스 → service         (서비스 식별값, constants.ts의 대응표 참고)
 *   제공받는자 → recipient       (제3자 제공 시에만 기록. 현재 서비스는 제3자 제공이 없어 항상 NULL)
 *   이용일시   → usedAt          (전송받은 시각. timestamptz라 초 이상의 정밀도를 보존)
 *
 * score_events(점수 원장)로는 이 요건을 대신할 수 없다 — 점수 원장은 점령이 "성공"했을 때만
 * 행이 생기지만, 법이 요구하는 것은 좌표를 "전송받은" 모든 시점의 기록이다. 거리 미달로 실패한
 * 인증 시도나 결투 매칭용 실시간 좌표 수신은 점수 원장에 남지 않는다.
 *
 * 이 테이블은 append-only다. 보존기간(6개월)이 지난 행만 정리 잡이 삭제하며 그 외의 수정·삭제는 없다.
 */
@Entity('location_usage_logs')
@Index(['subjectId', 'usedAt'])
export class LocationUsageLog {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * 이용자 UUID. users에 FK를 걸지 않는다 — 법정 보존 자료이므로 이용자가 탈퇴해
   * users 행이 사라져도 원장은 기록 당시의 식별값을 그대로 유지해야 한다.
   * (score_events는 팀 점수 집계가 목적이라 ON DELETE SET NULL을 쓰지만, 여기는 성격이 다르다.)
   */
  @Column({ type: 'uuid' })
  subjectId: string;

  @Column({ type: 'varchar', length: 20 })
  acquisitionPath: string;

  @Column({ type: 'varchar', length: 20 })
  service: string;

  /** 제3자 제공이 없으면 NULL. 신고서에는 "개인위치정보의 제3자 제공 없는 서비스"로 기재한다. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  recipient: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  usedAt: Date;
}
