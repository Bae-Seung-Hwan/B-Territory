import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { LocationUsageLog } from './entities/location-usage-log.entity';
import { LocationLogsService } from './location-logs.service';
import { LocationLogsProcessor } from './location-logs.processor';
import { LOCATION_LOG_QUEUE } from './constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([LocationUsageLog]),
    BullModule.registerQueue({ name: LOCATION_LOG_QUEUE }),
  ],
  providers: [LocationLogsService, LocationLogsProcessor],
  exports: [LocationLogsService],
})
export class LocationLogsModule implements OnModuleInit {
  private readonly logger = new Logger(LocationLogsModule.name);

  constructor(@InjectQueue(LOCATION_LOG_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      // ClaimsModule과 동일한 패턴 — 기존 repeatable 잡을 제거 후 재등록해 키 불일치로 인한 중복을 막는다.
      // (인스턴스 2개 이상 동시 기동 시 중복 등록될 수 있는 한계도 동일하다.)
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'purge')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );

      // 매일 04:00 KST — 트래픽이 가장 적은 시간대에 보존기간 만료분을 정리한다.
      await this.queue.add(
        'purge',
        {},
        {
          repeat: { cron: '0 4 * * *', tz: 'Asia/Seoul' },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
        },
      );
    } catch (err) {
      this.logger.error(
        'location-log purge 잡 등록 실패 (Redis 연결 확인 필요)',
        err,
      );
    }
  }
}
