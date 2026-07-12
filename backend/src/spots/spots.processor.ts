import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SpotsService } from './spots.service';

@Processor('spot-sync')
export class SpotsProcessor {
  private readonly logger = new Logger(SpotsProcessor.name);

  constructor(private readonly spotsService: SpotsService) {}

  @Process('sync')
  async handleSync(job: Job) {
    this.logger.log(`관광지 API 동기화 시작 (jobId: ${job.id})`);
    const result = await this.spotsService.syncFromApi();
    this.logger.log(
      `동기화 완료: ${result.synced}건 upsert, ${result.deleted}건 삭제`,
    );
    return result;
  }
}
