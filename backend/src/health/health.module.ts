import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** RedisModule은 @Global이고 DataSource는 TypeOrmModule.forRoot가 제공하므로 별도 import가 없다. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
