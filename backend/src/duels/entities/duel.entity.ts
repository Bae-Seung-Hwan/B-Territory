import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum DuelStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  COMPLETED = 'COMPLETED',
  VOID = 'VOID',
}

@Entity('duels')
export class Duel {
  @PrimaryGeneratedColumn()
  id: number;

  // 탈퇴 시 SET NULL — 결투는 두 사람의 기록이라, 한쪽이 탈퇴했다고 행을 지우면
  // 상대방의 전적까지 사라진다. score_events 등 다른 유저 참조와 같은 정책이다.
  // nullable이 아니면 결투 이력이 있는 유저는 FK 위반(23503)으로 탈퇴 자체가 실패한다.
  //
  // DB는 nullable이지만 TS 타입은 string으로 둔다. NULL이 되는 건 탈퇴로 참가자가 사라진
  // "과거" 행뿐이고, 이 서비스는 duelRepo.findOne({ id })로 진행 중인 결투만 읽기 때문이다
  // (완료된 결투를 목록으로 조회하는 경로는 아직 없다). 그런 조회를 추가할 때는 두 컬럼을
  // string | null로 좁히고 호출부를 함께 정리해야 한다.
  @Column({ type: 'uuid', nullable: true })
  challengerId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'challengerId' })
  challenger: User;

  @Column({ type: 'uuid', nullable: true })
  opponentId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'opponentId' })
  opponent: User;

  @Column({ type: 'enum', enum: DuelStatus, default: DuelStatus.PENDING })
  status: DuelStatus;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  loserId: string | null;

  /**
   * 확정된 점수 증감의 **크기**(항상 양수, 명목값).
   * - COMPLETED: 승자 +scoreDelta, 패자 -scoreDelta
   * - REJECTED / EXPIRED: 응답하지 않은 쪽(opponentId)에 -scoreDelta. 승자가 없으므로
   *   winnerId/loserId는 null이다. 차감이 실제로 일어난 행에만 채워지므로, 상대가 이미
   *   탈퇴해 깎을 대상이 없었던 만료나 탈퇴로 끝난 결투에서는 null로 남는다
   */
  @Column({ type: 'int', nullable: true })
  scoreDelta: number | null;

  @Column({ type: 'boolean', default: false })
  allyBonusApplied: boolean;

  @CreateDateColumn()
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  /** 마지막 결과 신고 접수 시각 (DB 시계) — 신고 진행 중인 결투를 스윕이 VOID로 선점하지 않도록 유예 판단에 사용 */
  @Column({ type: 'timestamp', nullable: true })
  resultReportedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
