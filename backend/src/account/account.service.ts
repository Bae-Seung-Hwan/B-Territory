import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { FirebaseService } from '../common/firebase/firebase.service';
import { RedisService } from '../common/redis/redis.service';
import { DuelsService } from '../duels/duels.service';

/**
 * 계정 삭제(탈퇴) — 앱스토어·플레이스토어가 계정 생성 앱에 요구하는 필수 기능이다.
 *
 * users·duels·Firebase·Redis에 걸친 도메인 횡단 작업이라 UsersService가 아니라 별도
 * 모듈에 둔다. UsersService에 두면 UsersModule이 DuelsModule을 참조해야 하는데,
 * DuelsModule과 ModerationModule이 이미 UsersModule을 쓰고 있어 삼각 순환이 생긴다
 * (부팅 시 서로의 심볼이 undefined가 되어 실제로 죽는다). 여기로 올리면 의존이
 * AccountModule -> {UsersModule, DuelsModule} 한 방향으로만 흐른다.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly firebaseService: FirebaseService,
    private readonly redis: RedisService,
    private readonly duelsService: DuelsService,
  ) {}

  /**
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
   * 지워지고 DB 삭제가 실패했을 때 로그인할 수 없는데 계정은 남은 상태가 된다. 이 순서의
   * 크래시 창(DB 커밋 직후 프로세스 사망)은 deleteOrphanedAuth가 받아낸다.
   */
  async deleteAccount(user: User): Promise<void> {
    // 진행 중인 결투 종료와 users 행 삭제를 한 트랜잭션에 묶는다. 종료 처리가
    // requestDuel과 같은 advisory lock을 잡으므로, 그 사이에 이 유저를 상대로 새 결투가
    // 만들어져 다시 참가자 한쪽이 NULL인 활성 행으로 남는 창이 닫힌다.
    const terminated = await this.dataSource.transaction(async (manager) => {
      const rows = await this.duelsService.terminateActiveDuelsFor(
        user.id,
        manager,
      );
      await manager.delete(User, { id: user.id });
      return rows;
    });

    // 락 해제·알림은 커밋 뒤에 한다 — 롤백된 트랜잭션의 결투를 상대에게 종료됐다고
    // 알리거나 아직 유효한 락을 풀어버리면 안 된다.
    await this.duelsService.settleTerminatedDuels(terminated, user.id);

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

  /**
   * DB 프로필 없이 Firebase 계정만 남은 상태를 정리한다 — deleteAccount의 크래시 복구 경로.
   *
   * deleteAccount는 DB 삭제를 먼저 커밋하는데, 그 직후 프로세스가 죽으면(배포·OOM)
   * Firebase 계정만 남는다. 이때 탈퇴 요청을 404로 막으면 재시도해도 이 계정에 손댈
   * 방법이 없어져, 그 이메일로 영구 재가입 불가가 된다 — 계정 삭제 기능이 애초에
   * 막으려던 바로 그 상태다. 그래서 프로필이 없어도 탈퇴는 성공으로 끝낸다(멱등).
   *
   * Redis 키는 유저 UUID로 저장되는데 그 id를 알 방법이 이미 사라졌으므로 손대지
   * 못한다. 참조 대상이 없는 키들이라 TTL로 소멸한다.
   */
  async deleteOrphanedAuth(firebaseUid: string): Promise<void> {
    this.logger.warn(
      `DB 프로필 없는 Firebase 계정 정리 (firebaseUid=${firebaseUid})`,
    );
    await this.firebaseService.deleteUser(firebaseUid);
  }
}
