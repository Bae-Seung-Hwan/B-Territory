import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './entities/review.entity';
import { MissionPhoto } from './entities/mission-photo.entity';
import { MissionsService } from './missions.service';
import { MissionsController } from './missions.controller';
import { UsersModule } from '../users/users.module';
import { ScoresModule } from '../scores/scores.module';
import { DistrictsModule } from '../districts/districts.module';

// RedisModule·S3Module은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [
    TypeOrmModule.forFeature([Review, MissionPhoto]),
    UsersModule,
    ScoresModule,
    DistrictsModule,
  ],
  controllers: [MissionsController],
  providers: [MissionsService],
})
export class MissionsModule {}
