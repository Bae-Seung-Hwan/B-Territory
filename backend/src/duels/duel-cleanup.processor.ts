import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DuelsService } from './duels.service';

@Processor('duel-cleanup')
export class DuelCleanupProcessor {
  private readonly logger = new Logger(DuelCleanupProcessor.name);

  constructor(private readonly duelsService: DuelsService) {}

  @Process('sweep')
  async handleSweep(job: Job) {
    const { expiredPending, voidedAccepted } =
      await this.duelsService.sweepStaleDuels();
    if (expiredPending > 0 || voidedAccepted > 0) {
      this.logger.log(
        `방치된 결투 정리: PENDING→EXPIRED ${expiredPending}건, ACCEPTED→VOID ${voidedAccepted}건 (jobId: ${job.id})`,
      );
    }
    return { expiredPending, voidedAccepted };
  }
}
