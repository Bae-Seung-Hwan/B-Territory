import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserConsent } from './entities/user-consent.entity';
import { ConsentsService } from './consents.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserConsent])],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
