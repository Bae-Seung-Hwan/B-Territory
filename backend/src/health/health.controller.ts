import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { RedisService } from '../common/redis/redis.service';

// 의존성 확인 상한(ms). 컨테이너 healthcheck의 timeout(5s)보다 짧게 잡아, 응답이 오지 않는
// 의존성 때문에 wget이 먼저 끊기고 "원인 불명 실패"가 되는 것을 막는다.
const PROBE_TIMEOUT_MS = 2000;

type DependencyState = 'up' | 'down';

interface HealthBody {
  status: 'ok' | 'degraded';
  db: DependencyState;
  redis: DependencyState;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms).unref();
    }),
  ]);
}

/**
 * 배포 게이트용 헬스체크.
 *
 * 루트(`GET /api`)는 정적 문자열이라 프로세스가 살아만 있으면 200이 나온다. 그것만으로는
 * "떠 있지만 실제로는 아무것도 못 하는" 상태를 걸러내지 못해, 의존성까지 확인하는 별도
 * 엔드포인트를 둔다. docker-compose의 backend healthcheck가 이 경로를 본다.
 *
 * DB와 Redis를 같은 등급으로 다루지 않는 것이 중요하다:
 * - **DB 불가 → 503.** 점령·결투·랭킹 전부가 DB에 의존하고, 앱은 부팅 시 CSV 시딩 실패를
 *   fail-fast로 처리할 만큼 DB를 필수로 본다. DB 없이 뜬 인스턴스는 배포를 통과하면 안 된다.
 * - **Redis 불가 → 200 (degraded).** 앱은 Redis 장애를 견디도록 설계돼 있다(캐시 미스로
 *   흡수하고 DB 원장으로 폴백). 여기서 503을 내면 그 설계와 모순되고, 배포 중 일시적인
 *   Redis 순단이 멀쩡한 배포를 실패시킨다. 상태는 응답 본문으로 드러내 모니터링에 남긴다.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: '헬스체크 (의존성 상태 포함)' })
  @ApiResponse({
    status: 200,
    description: 'DB 정상 (redis=down이면 degraded)',
  })
  @ApiResponse({ status: 503, description: 'DB 도달 불가' })
  async check(@Res() res: Response): Promise<void> {
    const [db, redis] = await Promise.all([
      this.probe(() => this.dataSource.query('SELECT 1')),
      this.probe(() => this.redis.ping()),
    ]);

    const body: HealthBody = {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      db,
      redis,
    };
    res.status(db === 'up' ? 200 : 503).json(body);
  }

  private async probe(fn: () => Promise<unknown>): Promise<DependencyState> {
    try {
      await withTimeout(fn(), PROBE_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
