import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

// TypeORM CLI(마이그레이션 생성/실행) 전용 DataSource.
// 앱 런타임 연결은 app.module.ts의 TypeOrmModule.forRootAsync가 담당하며,
// 여기의 접속 정보는 그것과 동일하게 .env에서 읽는다 (이미 설정된 process.env가 우선).
dotenv.config();

// app.module.ts의 TypeOrmModule.forRootAsync와 동일하게 폴백 없이 .env 값을 그대로 쓴다 —
// 여기만 기본값을 두면 .env가 일부 비어 있을 때 CLI가 앱과 다른 DB를 조용히 가리킬 수 있다.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // CLI는 ts-node로 실행되므로(typeorm-ts-node-commonjs) ts 글롭을 사용한다
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
