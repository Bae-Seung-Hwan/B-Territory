import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { FirebaseService } from '../common/firebase/firebase.service';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly firebaseService: FirebaseService,
    private readonly redis: RedisService,
  ) {}

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { firebaseUid } });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.userRepository.find({ where: { id: In(ids) } });
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

  /**
   * 계정 삭제 (탈퇴). 앱스토어·플레이스토어가 계정 생성 앱에 요구하는 필수 기능이다.
   *
   * 남기는 것 / 지우는 것:
   * - `users` 행은 **하드 삭제**한다. 익명화(닉네임만 교체)로는 안 되는데, 개인 랭킹이
   *   `score_events JOIN users`(INNER)라 행을 남기면 탈퇴한 유저가 명예의 전당에 계속
   *   노출되기 때문이다. 하드 삭제하면 조인에서 자연히 빠진다.
   * - 원장·점령·결투는 FK가 전부 SET NULL이라 행은 남고 유저 참조만 끊긴다. 팀 점수는
   *   `score_events.team`으로 집계해 users를 조인하지 않으므로 그대로 보존된다.
   * - `location_usage_logs`는 **건드리지 않는다.** 위치정보법 제16조 2항의 법정 보존
   *   자료(6개월)이며, 그래서 애초에 users FK를 걸지 않았다(docs/compliance.md 4장).
   *   개인정보처리방침에 "탈퇴 후에도 이 기록은 보존된다"를 명시해야 한다.
   * - Firebase Auth 계정도 지운다. 남겨두면 같은 이메일로 재가입이 영구 불가해진다.
   *
   * 순서가 중요하다. DB 삭제를 먼저 커밋한 뒤 Firebase를 지운다 — 반대로 하면 Firebase만
   * 지워지고 DB 삭제가 실패했을 때 로그인할 수 없는데 계정은 남은 상태가 된다. 이 순서에서는
   * 최악의 경우 Firebase 계정만 남는데, 그건 재시도로 정리할 수 있고 DB에 프로필이 없으니
   * 서비스 이용도 불가능하다(모든 API가 USER_NOT_REGISTERED).
   */
  async deleteAccount(user: User): Promise<void> {
    await this.userRepository.delete({ id: user.id });

    await this.firebaseService.deleteUser(user.firebaseUid);

    // Redis 정리는 실패해도 탈퇴를 되돌리지 않는다 — 계정은 이미 사라졌고 남은 키는
    // 전부 TTL로 소멸한다. 다만 조용히 넘기지 않고 로그로 남긴다.
    try {
      await this.redis.purgeUserKeys(user.id);
    } catch (err) {
      this.logger.warn(
        `탈퇴 후 Redis 정리 실패 (userId=${user.id}): ${(err as Error).message}`,
      );
    }
  }
}
