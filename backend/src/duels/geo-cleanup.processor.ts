import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { RedisService } from '../common/redis/redis.service';
import { GEO_STALE_TTL } from './constants';

@Processor('geo-cleanup')
export class GeoCleanupProcessor {
  private readonly logger = new Logger(GeoCleanupProcessor.name);

  constructor(private readonly redis: RedisService) {}

  @Process('prune')
  async handlePrune(job: Job) {
    const removed = await this.redis.pruneStaleGeo(GEO_STALE_TTL);
    if (removed > 0) {
      this.logger.log(`유령 좌표 ${removed}건 정리 (jobId: ${job.id})`);
    }
    return { removed };
  }
}
