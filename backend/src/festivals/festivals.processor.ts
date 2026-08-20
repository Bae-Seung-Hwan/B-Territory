import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { FestivalsService } from './festivals.service';

@Processor('festival-sync')
export class FestivalsProcessor {
  private readonly logger = new Logger(FestivalsProcessor.name);

  constructor(private readonly festivalsService: FestivalsService) {}

  @Process('sync')
  async handleSync(job: Job) {
    this.logger.log(`축제 동기화 시작 (jobId: ${job.id})`);
    const result = await this.festivalsService.syncFromApi();
    this.logger.log(
      `축제 동기화 완료: upsert ${result.synced}건, 정리 ${result.deleted}건`,
    );
    return result;
  }
}
