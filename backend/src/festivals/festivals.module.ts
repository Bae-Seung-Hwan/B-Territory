import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Festival } from './entities/festival.entity';
import { FestivalsService } from './festivals.service';
import { FestivalsController } from './festivals.controller';
import { FestivalsProcessor } from './festivals.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Festival]),
    BullModule.registerQueue({ name: 'festival-sync' }),
  ],
  controllers: [FestivalsController],
  providers: [FestivalsService, FestivalsProcessor],
})
export class FestivalsModule implements OnModuleInit {
  private readonly logger = new Logger(FestivalsModule.name);

  constructor(@InjectQueue('festival-sync') private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      // 기존 repeatable 잡 전체 제거 후 재등록 (키 불일치로 인한 중복 방지)
      // 주의: 인스턴스 2개 이상 동시 기동 시 잡이 중복 등록될 수 있음
      // 스케일아웃 시에는 별도 스케줄러 인스턴스를 두거나 Redis 분산 락으로 직렬화 필요
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'sync')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );

      const jobOptions = {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      };
      // tz 미지정 시 서버 로컬 시간(컨테이너 기본 UTC) 기준으로 실행되므로 KST 고정.
      // 매일 04:00 KST — 트래픽이 적은 새벽에 1회 동기화.
      await this.queue.add(
        'sync',
        {},
        { repeat: { cron: '0 4 * * *', tz: 'Asia/Seoul' }, ...jobOptions },
      );
    } catch (err) {
      this.logger.error(
        'festival-sync 잡 등록 실패 (Redis 연결 확인 필요)',
        err,
      );
    }
  }
}
