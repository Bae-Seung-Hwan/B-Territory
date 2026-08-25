import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserBlock } from './entities/user-block.entity';
import { Report } from './entities/report.entity';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserBlock, Report]), UsersModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
