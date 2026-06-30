import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Spot } from './entities/spot.entity';
import { SpotsController } from './spots.controller';
import { SpotsService } from './spots.service';
import { SpotsProcessor } from './spots.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Spot]),
    BullModule.registerQueue({ name: 'spot-sync' }),
  ],
  controllers: [SpotsController],
  providers: [SpotsService, SpotsProcessor],
  exports: [SpotsService],
})
export class SpotsModule implements OnModuleInit {
  constructor(@InjectQueue('spot-sync') private readonly queue: Queue) {}

  async onModuleInit() {
    // 기존 repeatable 잡 제거 후 재등록 (키 불일치로 인한 중복 방지)
    // 주의: 인스턴스 2개 이상 동시 기동 시 잡이 중복 등록될 수 있음
    const existing = await this.queue.getRepeatableJobs();
    await Promise.all(
      existing
        .filter((j) => j.name === 'sync')
        .map((j) => this.queue.removeRepeatableByKey(j.key)),
    );

    // 매주 월요일 새벽 3시 동기화 (부산 관광공사 API 업데이트 주기 반영)
    await this.queue.add('sync', {}, { repeat: { cron: '0 3 * * 1' } });
  }
}
