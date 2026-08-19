import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import {
  LocationLogsService,
  RecordLocationUsageInput,
} from './location-logs.service';
import { LOCATION_LOG_QUEUE } from './constants';

@Processor(LOCATION_LOG_QUEUE)
export class LocationLogsProcessor {
  private readonly logger = new Logger(LocationLogsProcessor.name);

  constructor(private readonly locationLogs: LocationLogsService) {}

  @Process('record')
  async handleRecord(job: Job<Required<RecordLocationUsageInput>>) {
    await this.locationLogs.persist(job.data);
  }

  @Process('purge')
  async handlePurge(job: Job) {
    const removed = await this.locationLogs.purgeExpired();
    if (removed > 0) {
      this.logger.log(
        `보존기간 만료 위치정보 이용사실 기록 ${removed}건 삭제 (jobId: ${job.id})`,
      );
    }
    return { removed };
  }
}
