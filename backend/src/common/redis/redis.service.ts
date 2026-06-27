import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
    });
    this.client.on('error', (err) => {
      console.error('[RedisService] connection error:', err.message);
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

  /** GET + TTL in a single pipeline to avoid TOCTOU between two calls */
  async getWithTtl(
    key: string,
  ): Promise<{ value: string | null; ttl: number }> {
    const [[, value], [, ttl]] = (await this.client
      .pipeline()
      .get(key)
      .ttl(key)
      .exec()) as [[null, string | null], [null, number]];
    return { value, ttl };
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
