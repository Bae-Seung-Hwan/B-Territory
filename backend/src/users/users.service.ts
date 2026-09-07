import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { firebaseUid } });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /**
   * manager를 넘기면 그 트랜잭션의 커넥션으로 읽는다. **진행 중인 트랜잭션 안에서
   * 호출할 때는 반드시 넘길 것** — 기본 리포지토리는 풀에서 두 번째 커넥션을 잡으므로,
   * 트랜잭션 하나가 커넥션을 쥔 채 또 하나를 요청하게 되어 동시 호출이 풀 크기를 넘기면
   * 전원이 서로를 기다리다 acquire 타임아웃까지 멈춘다.
   */
  async findByIds(ids: string[], manager?: EntityManager): Promise<User[]> {
    if (ids.length === 0) return [];
    const repo = manager ? manager.getRepository(User) : this.userRepository;
    return repo.find({ where: { id: In(ids) } });
  }

  /**
   * 본인 프로필 매퍼 — 이메일 포함 + 현재 점수. auth(/auth/me·register)와 users(/users/me)가
   * 같은 형태를 반환하도록 한 곳에서 만든다. score는 저장 직후 엔티티에 DB 기본값이 아직
   * 채워지지 않은 경우(가입 응답)를 대비해 0으로 폴백한다.
   */
  toProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      nationality: user.nationality,
      team: user.team,
      score: user.score ?? 0,
    };
  }

  /** 타 유저 공개 프로필 — 이메일 등 민감 정보 제외, 점수는 공개. */
  toPublicProfile(user: User) {
    return {
      id: user.id,
      nickname: user.nickname,
      nationality: user.nationality,
      team: user.team,
      score: user.score ?? 0,
    };
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  /**
   * 원자적 점수 증감 (동시 결투 결과 반영 시 레이스 방지) — 하한 0, 감점으로 마이너스가 되지 않는다.
   * manager를 넘기면 해당 트랜잭션에 참여한다 (결투 상태 확정과 점수 반영의 원자성 보장용).
   */
  async applyScoreDelta(
    userId: string,
    delta: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(User) : this.userRepository;
    await repo
      .createQueryBuilder()
      .update(User)
      .set({ score: () => 'GREATEST(0, score + :delta)' })
      .where('id = :id', { id: userId })
      .setParameters({ delta })
      .execute();
  }
}
