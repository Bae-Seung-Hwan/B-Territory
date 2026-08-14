import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DistrictsService } from './districts.service';

@Processor('capital-designation')
export class CapitalProcessor {
  private readonly logger = new Logger(CapitalProcessor.name);

  constructor(private readonly districtsService: DistrictsService) {}

  @Process('designate')
  async handleDesignate(job: Job) {
    this.logger.log(`주간 수도 지정 시작 (jobId: ${job.id})`);
    const result = await this.districtsService.designateWeeklyCapital();
    this.logger.log(`수도 지정 완료: ${result?.sigunguCode ?? '(대상 없음)'}`);
    return result;
  }
}
