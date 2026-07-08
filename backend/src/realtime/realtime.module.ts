import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';

@Module({
  imports: [UsersModule, DuelsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
