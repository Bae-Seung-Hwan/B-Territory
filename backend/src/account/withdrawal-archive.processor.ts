import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { WithdrawalArchiveService } from './withdrawal-archive.service';
import { WITHDRAWAL_ARCHIVE_QUEUE } from './constants';

@Processor(WITHDRAWAL_ARCHIVE_QUEUE)
export class WithdrawalArchiveProcessor {
  private readonly logger = new Logger(WithdrawalArchiveProcessor.name);

  constructor(private readonly archive: WithdrawalArchiveService) {}

  @Process('purge')
  async handlePurge(job: Job) {
    const removed = await this.archive.purgeExpired();
    if (removed > 0) {
      this.logger.log(
        `보존기간 만료 탈퇴 보관 기록 ${removed}건 파기 (jobId: ${job.id})`,
      );
    }
    return { removed };
  }
}
