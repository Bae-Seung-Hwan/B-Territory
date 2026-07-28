import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Duel } from './entities/duel.entity';
import { DuelsService } from './duels.service';
import { GeoCleanupProcessor } from './geo-cleanup.processor';
import { DuelCleanupProcessor } from './duel-cleanup.processor';
import { UsersModule } from '../users/users.module';
import { DUEL_SWEEP_INTERVAL_MS, GEO_PRUNE_INTERVAL_MS } from './constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Duel]),
    BullModule.registerQueue({ name: 'geo-cleanup' }),
    BullModule.registerQueue({ name: 'duel-cleanup' }),
    UsersModule,
  ],
  providers: [DuelsService, GeoCleanupProcessor, DuelCleanupProcessor],
  exports: [DuelsService],
})
export class DuelsModule implements OnModuleInit {
  private readonly logger = new Logger(DuelsModule.name);

  constructor(
    @InjectQueue('geo-cleanup') private readonly geoQueue: Queue,
    @InjectQueue('duel-cleanup') private readonly duelQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.registerRepeatable(
      this.geoQueue,
      'prune',
      GEO_PRUNE_INTERVAL_MS,
    );
    await this.registerRepeatable(
      this.duelQueue,
      'sweep',
      DUEL_SWEEP_INTERVAL_MS,
    );
  }

  private async registerRepeatable(
    queue: Queue,
    name: string,
    everyMs: number,
  ): Promise<void> {
    try {
      // 기존 repeatable 잡 전체 제거 후 재등록 (키 불일치로 인한 중복 방지)
      const existing = await queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === name)
          .map((j) => queue.removeRepeatableByKey(j.key)),
      );

      await queue.add(
        name,
        {},
        {
          repeat: { every: everyMs },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      );
    } catch (err) {
      this.logger.error(
        `${queue.name}:${name} 잡 등록 실패 (Redis 연결 확인 필요)`,
        err,
      );
    }
  }
}
