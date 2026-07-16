import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

// TypeORM CLI(마이그레이션 생성/실행) 전용 DataSource.
// 앱 런타임 연결은 app.module.ts의 TypeOrmModule.forRootAsync가 담당하며,
// 여기의 접속 정보는 그것과 동일하게 .env에서 읽는다 (이미 설정된 process.env가 우선).
dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'b_territory',
  // CLI는 ts-node로 실행되므로(typeorm-ts-node-commonjs) ts 글롭을 사용한다
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
