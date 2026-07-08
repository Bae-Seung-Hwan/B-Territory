import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Duel } from './entities/duel.entity';
import { DuelsService } from './duels.service';
import { GeoCleanupProcessor } from './geo-cleanup.processor';
import { UsersModule } from '../users/users.module';
import { GEO_PRUNE_INTERVAL_MS } from './constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Duel]),
    BullModule.registerQueue({ name: 'geo-cleanup' }),
    UsersModule,
  ],
  providers: [DuelsService, GeoCleanupProcessor],
  exports: [DuelsService],
})
export class DuelsModule implements OnModuleInit {
  private readonly logger = new Logger(DuelsModule.name);

  constructor(@InjectQueue('geo-cleanup') private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      // 기존 repeatable 잡 전체 제거 후 재등록 (키 불일치로 인한 중복 방지)
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'prune')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );

      await this.queue.add(
        'prune',
        {},
        {
          repeat: { every: GEO_PRUNE_INTERVAL_MS },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      );
    } catch (err) {
      this.logger.error('geo-cleanup 잡 등록 실패 (Redis 연결 확인 필요)', err);
    }
  }
}
