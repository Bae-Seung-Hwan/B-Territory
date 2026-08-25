import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';
import { LocationLogsModule } from '../location-logs/location-logs.module';

@Module({
  imports: [UsersModule, DuelsModule, LocationLogsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
