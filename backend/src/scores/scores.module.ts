import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScoreEvent } from './entities/score-event.entity';
import { ScoresService } from './scores.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScoreEvent])],
  providers: [ScoresService],
  exports: [ScoresService],
})
export class ScoresModule {}
