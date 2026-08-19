import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * 사용자 차단 — Apple 심사 가이드라인 1.2(UGC)가 요구하는 "악성 사용자 차단" 수단.
 *
 * 차단은 단방향이다(내가 상대를 안 보는 것). 상대는 내가 차단했다는 사실을 알 수 없고,
 * 여전히 팀 룸에 메시지를 보낼 수 있다 — 다만 나에게 릴레이되지 않는다.
 *
 * 탈퇴 대응: 양쪽 FK 모두 CASCADE다. 차단 관계는 두 계정이 모두 존재할 때만 의미가 있는
 * 파생 데이터라, 한쪽이 사라지면 관계 자체가 사라지는 게 맞다(원장처럼 보존할 근거가 없다).
 */
@Entity('user_blocks')
@Unique(['blockerId', 'blockedId'])
@Index(['blockedId']) // "나를 차단한 사람" 역조회 — 릴레이 필터가 쓴다
export class UserBlock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  blockerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockerId' })
  blocker: User;

  @Column({ type: 'uuid' })
  blockedId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockedId' })
  blocked: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
