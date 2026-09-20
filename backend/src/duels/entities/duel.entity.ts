import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
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
// 같은 신청자의 같은 requestId는 결투 하나에만 묶인다 (DuelsService.requestDuel 멱등성).
// requestId를 보내지 않는 구버전 앱의 행은 제외한다.
@Index('IDX_duels_challenger_request', ['challengerId', 'requestId'], {
  unique: true,
  where: '"requestId" IS NOT NULL',
})
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

  /**
   * 클라이언트가 duel:request마다 만든 uuid. 재시도를 같은 결투로 묶는 데 쓰고(멱등성),
   * 모든 결투 이벤트에 실어 ack보다 먼저 온 이벤트도 어느 요청의 것인지 가릴 수 있게 한다.
   * 구버전 앱은 보내지 않아 NULL이다.
   */
  @Column({ type: 'uuid', nullable: true })
  requestId: string | null;

  /**
   * 상태 버전. 생성 시 0이고 status가 바뀌는 모든 UPDATE가 같은 문장에서 1씩 올린다.
   *
   * 클라이언트는 결투별로 마지막에 반영한 revision을 들고 그 이하를 버린다 — 이벤트·ack의
   * 도착 순서가 뒤집혀도 오래된 상태가 새 상태를 덮지 않는다. 앱 메모리에서 올리지 않고
   * 반드시 SQL(`"revision" + 1`)로 올릴 것: 조건부 UPDATE의 CAS와 같은 문장이어야 경합하는
   * 두 전이가 같은 번호를 내지 않는다.
   */
  @Column({ type: 'int', default: 0 })
  revision: number;

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

  /**
   * duel:requested를 상대의 살아 있는 소켓으로 실제 emit한 시각. 큐에만 쌓였으면 NULL이다.
   *
   * 무응답 페널티의 유일한 근거다 — 받은 적 없는 초대에 "무응답"을 물릴 수는 없다.
   * 전달 여부는 emit 시점에 확정되는 사실이라 여기에 남긴다. 만료 시점(T+30s)에 소켓
   * 생존을 다시 확인하는 방식은 ping timeout만큼의 감지 지연이 있어 창 후반부의 단절을
   * 놓쳤고, 타이머가 유실돼 sweepStaleDuels로 넘어간 신청은 아예 확인할 방법이 없었다.
   */
  @Column({ type: 'timestamp', nullable: true })
  inviteDeliveredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  /** 마지막 결과 신고 접수 시각 (DB 시계) — 신고 진행 중인 결투를 스윕이 VOID로 선점하지 않도록 유예 판단에 사용 */
  @Column({ type: 'timestamp', nullable: true })
  resultReportedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
