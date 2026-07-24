import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScoreEvent } from './entities/score-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ScoreEvent])],
})
export class ScoresModule {}
