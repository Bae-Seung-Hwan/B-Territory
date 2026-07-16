import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Spot } from './entities/spot.entity';
import { SpotsController } from './spots.controller';
import { SpotsService } from './spots.service';
import { RedisService } from '../common/redis/redis.service';

@Module({
  imports: [TypeOrmModule.forFeature([Spot])],
  controllers: [SpotsController],
  providers: [SpotsService],
  exports: [SpotsService],
})
export class SpotsModule implements OnModuleInit {
  private readonly logger = new Logger(SpotsModule.name);

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    // 구 KTO 주간 재동기화(spot-sync) 잡의 leftover 정리. 큐 등록과 자기 정리 로직
    // (removeRepeatableByKey)이 CSV 시딩 전환으로 함께 삭제되어, 이전 코드를 실행했던
    // 환경의 Redis에는 반복 잡 스케줄 키가 남아도 지울 코드가 없다. 방치하면 향후
    // 같은 이름의 큐를 재도입할 때 옛 cron 스케줄이 섞여 들어갈 수 있으므로, 큐를
    // 아는 코드가 더 이상 없는 지금은 키를 직접 삭제한다. (정리된 환경에서는 no-op)
    try {
      const removed = await this.redis.deleteByPattern('bull:spot-sync:*');
      if (removed > 0) {
        this.logger.log(
          `구 spot-sync 반복 잡 잔여 키 ${removed}개를 정리했습니다`,
        );
      }
    } catch (err) {
      this.logger.error(
        '구 spot-sync 잔여 키 정리 실패 (Redis 연결 확인 필요)',
        err,
      );
    }
  }
}
