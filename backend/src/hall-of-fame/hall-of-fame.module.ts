import { Module } from '@nestjs/common';
import { ScoresModule } from '../scores/scores.module';
import { HallOfFameService } from './hall-of-fame.service';
import { HallOfFameController } from './hall-of-fame.controller';

// ScoresModule이 ScoresService를 export하고, RedisModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [ScoresModule],
  controllers: [HallOfFameController],
  providers: [HallOfFameService],
})
export class HallOfFameModule {}
