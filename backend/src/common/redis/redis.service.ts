import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_DB', 0),
    });
    this.client.on('error', (err) => {
      this.logger.error(`connection error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * 방어 타이머 원자 연산 (Lua 스크립트)
   * - 키 없음: 타이머 신규 설정 후 'ok' (created: true)
   * - 같은 팀:  타이머 리셋 없이 'ok' (무한 리셋 방지, created: false)
   * - 다른 팀:  'blocked' + 현재 방어팀 + 남은 초
   * created는 실패 시 롤백에서 신규 키만 지우기 위한 구분값
   */
  async claimDefense(
    key: string,
    team: string,
    ttl: number,
  ): Promise<
    | { status: 'ok'; remaining: number; created: boolean }
    | { status: 'blocked'; defenseTeam: string; remaining: number }
  > {
    const lua = `
      local v = redis.call('GET', KEYS[1])
      if v == false then
        redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
        return {'ok', tonumber(ARGV[2]), 1}
      elseif v == ARGV[1] then
        local remaining = redis.call('TTL', KEYS[1])
        return {'ok', remaining, 0}
      else
        local remaining = redis.call('TTL', KEYS[1])
        return {'blocked', v, remaining}
      end
    `;
    const result = (await this.client.eval(lua, 1, key, team, String(ttl))) as (
      | string
      | number
    )[];
    if (result[0] === 'ok')
      return {
        status: 'ok',
        remaining: Number(result[1]),
        created: result[2] === 1,
      };
    return {
      status: 'blocked',
      defenseTeam: result[1] as string,
      remaining: Number(result[2]),
    };
  }
}
