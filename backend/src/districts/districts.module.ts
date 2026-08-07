import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { District } from './entities/district.entity';
import { CapitalDesignation } from './entities/capital-designation.entity';
import { DistrictsService } from './districts.service';
import { DistrictsController } from './districts.controller';
import { CapitalProcessor } from './capital.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([District, CapitalDesignation]),
    BullModule.registerQueue({ name: 'capital-designation' }),
  ],
  controllers: [DistrictsController],
  providers: [DistrictsService, CapitalProcessor],
  exports: [DistrictsService],
})
export class DistrictsModule implements OnModuleInit {
  private readonly logger = new Logger(DistrictsModule.name);

  constructor(
    @InjectQueue('capital-designation') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    try {
      // 기존 repeatable 잡 전체 제거 후 재등록 (키 불일치로 인한 중복 방지).
      // 주의: 인스턴스 2개 이상 동시 기동 시 잡이 중복 등록될 수 있음 —
      // 스케일아웃 시에는 별도 스케줄러 인스턴스나 Redis 분산 락으로 직렬화 필요.
      // (district-aggregation 큐와 동일 패턴)
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'designate')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );

      // tz 미지정 시 서버 로컬 시간(컨테이너 기본 UTC) 기준으로 실행되므로 KST 고정.
      // 매주 월요일 그 주의 수도를 랜덤 지정한다.
      //
      // 00:00 정각이 아니라 00:05인 이유: 프로세서가 startOfKstWeek(new Date())로 주를 다시
      // 계산하는데, 발화 시각이 주 경계와 정확히 겹치면 인스턴스 간 시계 편차나 NTP 역방향
      // 보정으로 new Date()가 일요일 23:59:59.x로 잡힐 수 있다. 그러면 지난주 weekStart가
      // 계산돼 "이미 지정됨"으로 조용히 건너뛰고, 새 주는 수도 없이 지나간다. 5분 여유를 두면
      // 어떤 현실적인 편차에도 경계 안쪽에서 실행된다.
      await this.queue.add(
        'designate',
        {},
        {
          repeat: { cron: '5 0 * * 1', tz: 'Asia/Seoul' },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      );
    } catch (err) {
      this.logger.error(
        'capital-designation 잡 등록 실패 (Redis 연결 확인 필요)',
        err,
      );
    }
  }
}
