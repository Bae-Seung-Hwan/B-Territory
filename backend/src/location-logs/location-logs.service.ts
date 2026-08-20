import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { LocationUsageLog } from './entities/location-usage-log.entity';
import {
  ACQUISITION_PATH_DEVICE_GPS,
  LOCATION_LOG_QUEUE,
  LocationServiceCode,
  RETENTION_INTERVAL,
} from './constants';

export interface RecordLocationUsageInput {
  /** 개인위치정보주체 식별값 (이용자 UUID) */
  subjectId: string;
  /** 제공서비스 식별값 */
  service: LocationServiceCode;
  /** 취득경로. 기본값은 이용자 단말 직접 수집. */
  acquisitionPath?: string;
  /** 제3자 제공 시 제공받는 자. 제공이 없으면 생략(NULL). */
  recipient?: string | null;
}

@Injectable()
export class LocationLogsService {
  private readonly logger = new Logger(LocationLogsService.name);

  constructor(
    @InjectRepository(LocationUsageLog)
    private readonly repo: Repository<LocationUsageLog>,
    @InjectQueue(LOCATION_LOG_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * 위치정보를 전송받은 사실을 기록한다.
   *
   * 호출 지점(방문 인증 API, 실시간 좌표 수신 핸들러)은 응답 지연이 그대로 사용자 경험이 되는
   * 경로이고 특히 실시간 좌표는 이용자당 수 초 간격으로 들어오므로, INSERT를 직접 await 하지 않고
   * 큐에 넘긴 뒤 즉시 반환한다. 잡은 재시도(attempts/backoff)로 보호되고 Redis가 noeviction으로
   * 운영되므로(docs/deployment.md) 일시적인 DB 장애에도 기록이 버려지지 않는다.
   *
   * 큐 적재 자체가 실패하면 기록이 유실되므로 에러 레벨로 남긴다 — 법정 기록이라 조용히 삼키지 않는다.
   */
  record(input: RecordLocationUsageInput): void {
    void this.queue
      .add(
        'record',
        {
          subjectId: input.subjectId,
          service: input.service,
          acquisitionPath: input.acquisitionPath ?? ACQUISITION_PATH_DEVICE_GPS,
          recipient: input.recipient ?? null,
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          // 5회 재시도까지 실패한 잡은 남겨 둔다 — 유실 사실 자체를 추적할 수 있어야 한다.
          removeOnFail: false,
        },
      )
      .catch((err) => {
        this.logger.error(
          `위치정보 이용사실 기록 큐 적재 실패 subjectId=${input.subjectId} service=${input.service}`,
          err,
        );
      });
  }

  /** 큐 워커가 호출하는 실제 적재. */
  async persist(input: Required<RecordLocationUsageInput>): Promise<void> {
    await this.repo.insert({
      subjectId: input.subjectId,
      service: input.service,
      acquisitionPath: input.acquisitionPath,
      recipient: input.recipient,
    });
  }

  /**
   * 보존기간이 지난 기록을 삭제한다. 법정 최소 보존기간(6개월)을 넘긴 행만 대상이며,
   * 그 안쪽 기록은 어떤 경로로도 수정·삭제하지 않는다.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('"usedAt" < now() - CAST(:interval AS interval)', {
        interval: RETENTION_INTERVAL,
      })
      .execute();
    return result.affected ?? 0;
  }
}
