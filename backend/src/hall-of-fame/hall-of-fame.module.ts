import { Module } from '@nestjs/common';
import { ScoresModule } from '../scores/scores.module';
import { HallOfFameService } from './hall-of-fame.service';
import { HallOfFameController } from './hall-of-fame.controller';

// ScoresModule이 ScoresService를 export하고, RedisModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [ScoresModule],
  controllers: [HallOfFameController],
  providers: [HallOfFameService],
  // 탈퇴(AccountModule)가 개인 랭킹 캐시를 무효화하기 위해 쓴다.
  exports: [HallOfFameService],
})
export class HallOfFameModule {}
