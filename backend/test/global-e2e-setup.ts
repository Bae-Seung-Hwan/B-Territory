import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

/**
 * e2e 전용 DB 준비
 * - 테스트가 users/spots를 TRUNCATE 하므로 개발 DB와 분리된 `<DB_NAME>_test`를 사용
 * - 테스트 DB가 없으면 생성하고 PostGIS 확장을 활성화
 * - Redis도 개발과 분리된 DB 번호를 사용하고 시작 전에 비움
 *   (방어 키가 `defense:<spotId>` 형태라 RESTART IDENTITY 후 개발 데이터와 충돌 가능)
 * - 여기서 덮어쓴 process.env는 jest 워커에 상속되며,
 *   @nestjs/config는 .env 파일보다 process.env를 우선하므로 앱이 테스트 리소스로 연결됨
 */
const TEST_REDIS_DB = '15';

export default async function globalSetup(): Promise<void> {
  config({ path: resolve(__dirname, '../.env') });

  const testDbName = `${process.env.DB_NAME ?? 'b_territory'}_test`;
  process.env.DB_NAME = testDbName;
  process.env.REDIS_DB = TEST_REDIS_DB;

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: Number(TEST_REDIS_DB),
  });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  const connection = {
    type: 'postgres' as const,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  };

  const admin = new DataSource({ ...connection, database: 'postgres' });
  await admin.initialize();
  try {
    const exists: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDbName],
    );
    if (exists.length === 0) {
      await admin.query(`CREATE DATABASE "${testDbName}"`);
    }
  } finally {
    await admin.destroy();
  }

  const testDb = new DataSource({ ...connection, database: testDbName });
  await testDb.initialize();
  try {
    await testDb.query('CREATE EXTENSION IF NOT EXISTS postgis');
  } finally {
    await testDb.destroy();
  }
}
