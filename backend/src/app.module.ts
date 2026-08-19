import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SpotsModule } from './spots/spots.module';
import { FirebaseModule } from './common/firebase/firebase.module';
import { RedisModule } from './common/redis/redis.module';
import { ClaimsModule } from './claims/claims.module';
import { DuelsModule } from './duels/duels.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ChatModule } from './chat/chat.module';
import { ModerationModule } from './moderation/moderation.module';
import { ScoresModule } from './scores/scores.module';
import { DistrictsModule } from './districts/districts.module';
import { HallOfFameModule } from './hall-of-fame/hall-of-fame.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        // dev/test: 엔티티 변경이 스키마에 자동 반영 (기존 팀 워크플로 유지)
        // production: synchronize가 꺼지는 대신 마이그레이션으로 스키마를 반영
        //   (스키마 변경 시 마이그레이션 생성 필수 — docs/MIGRATIONS.md 참고)
        // 부팅 시 자동 실행(migrationsRun)은 쓰지 않는다 — 인스턴스가 겹쳐 뜨는 순간(롤링
        //   재배포 등) TypeORM의 migrations 북키핑 테이블 생성 단계에서 경쟁 상태가 재현되므로,
        //   `npm run migration:run`을 배포 파이프라인의 별도 1회성 스텝으로 실행한다.
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          db: config.get<number>('REDIS_DB', 0),
          // RedisService와 동일하게, Redis에 도달하지 못할 때 부팅 시 Bull 큐 호출
          // (getRepeatableJobs 등)이 예외로 전환되기까지 걸리는 시간을 줄인다. ioredis
          // 기본값은 20회라 재시도 백오프(min(times*50, 2000)ms)까지 더하면 큐 등록부가
          // 수십 초 동안 app.listen()에 도달하지 못한다 — 실측으로 부팅 4개 큐에 43초가
          // 걸렸다. 무한 대기는 아니지만 그 사이 앱 전체가 응답 불가다.
          // bull은 blocking용 서브 연결(bclient·subscriber)에는 maxRetriesPerRequest를
          // 자체적으로 null로 덮어쓰므로, 이 값은 일반 명령용 client 연결에만 적용된다.
          connectTimeout: 5000,
          maxRetriesPerRequest: 3,
        },
      }),
    }),
    FirebaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    SpotsModule,
    ClaimsModule,
    DuelsModule,
    RealtimeModule,
    ChatModule,
    ModerationModule,
    ScoresModule,
    DistrictsModule,
    HallOfFameModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
