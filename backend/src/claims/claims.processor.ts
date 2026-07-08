import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ClaimsService } from './claims.service';

@Processor('district-aggregation')
export class ClaimsProcessor {
  private readonly logger = new Logger(ClaimsProcessor.name);

  constructor(private readonly claimsService: ClaimsService) {}

  @Process('aggregate')
  async handleAggregate(job: Job) {
    this.logger.log(`구 단위 점령 집계 시작 (jobId: ${job.id})`);
    const result = await this.claimsService.aggregateDistricts();
    this.logger.log(`집계 완료: ${result.aggregated}개 구 처리`);
    return result;
  }
}
