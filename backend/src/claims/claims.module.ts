import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SpotClaim } from './entities/spot-claim.entity';
import { DistrictClaim } from './entities/district-claim.entity';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { ClaimsProcessor } from './claims.processor';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpotClaim, DistrictClaim]),
    BullModule.registerQueue({ name: 'district-aggregation' }),
    UsersModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimsProcessor],
})
export class ClaimsModule implements OnModuleInit {
  constructor(
    @InjectQueue('district-aggregation') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // 기존 repeatable 잡 전체 제거 후 재등록 (키 불일치로 인한 중복 방지)
    // 주의: 인스턴스 2개 이상 동시 기동 시 잡이 중복 등록될 수 있음
    // 스케일아웃 시에는 별도 스케줄러 인스턴스를 두거나 Redis 분산 락으로 직렬화 필요
    const existing = await this.queue.getRepeatableJobs();
    await Promise.all(
      existing
        .filter((j) => j.name === 'aggregate')
        .map((j) => this.queue.removeRepeatableByKey(j.key)),
    );

    await this.queue.add('aggregate', {}, { repeat: { cron: '0 0 * * *' } });
    await this.queue.add('aggregate', {}, { repeat: { cron: '0 12 * * *' } });
  }
}
