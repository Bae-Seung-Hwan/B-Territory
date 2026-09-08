import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';
import { HallOfFameModule } from '../hall-of-fame/hall-of-fame.module';
import { WithdrawalArchiveService } from './withdrawal-archive.service';
import { WithdrawalArchiveProcessor } from './withdrawal-archive.processor';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';
import { Report } from '../moderation/entities/report.entity';
import { WITHDRAWAL_ARCHIVE_QUEUE } from './constants';

// 탈퇴는 users·duels·Firebase·Redis에 걸쳐 있다. 두 모듈을 여기서 한 방향으로만
// 끌어써서 UsersModule <-> DuelsModule 순환을 만들지 않는다.
// FirebaseModule·RedisModule·WsModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  // HallOfFameModule은 개인 랭킹 캐시(닉네임 포함)를 무효화하기 위해 쓴다.
  // forFeature는 탈퇴 시 동의·신고 기록을 옮기는 보관 표들을 위한 것이다
  // (WithdrawalArchiveService). consents·moderation 두 도메인에 걸쳐 있어 어느 한쪽 모듈이
  // 아니라 이미 도메인 횡단인 이 모듈에 둔다.
  imports: [
    UsersModule,
    DuelsModule,
    HallOfFameModule,
    TypeOrmModule.forFeature([WithdrawnAccount, ConsentArchive, Report]),
    BullModule.registerQueue({ name: WITHDRAWAL_ARCHIVE_QUEUE }),
  ],
  controllers: [AccountController],
  providers: [
    AccountService,
    WithdrawalArchiveService,
    WithdrawalArchiveProcessor,
  ],
})
export class AccountModule implements OnModuleInit {
  private readonly logger = new Logger(AccountModule.name);

  constructor(
    @InjectQueue(WITHDRAWAL_ARCHIVE_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    try {
      // LocationLogsModule과 동일한 패턴 — 기존 repeatable 잡을 제거 후 재등록해 키 불일치로
      // 인한 중복을 막는다. (인스턴스 2개 이상 동시 기동 시 중복 등록될 수 있는 한계도 동일.)
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'purge')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );

      // 매일 04:10 KST — location-log purge(04:00)와 같은 한산한 시간대를 쓰되, 두 삭제
      // 잡이 같은 순간에 겹치지 않도록 10분 늦춘다.
      await this.queue.add(
        'purge',
        {},
        {
          repeat: { cron: '10 4 * * *', tz: 'Asia/Seoul' },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
        },
      );
    } catch (err) {
      this.logger.error(
        '탈퇴 보관 purge 잡 등록 실패 (Redis 연결 확인 필요)',
        err,
      );
    }
  }
}
