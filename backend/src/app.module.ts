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
import { ScoresModule } from './scores/scores.module';
import { DistrictsModule } from './districts/districts.module';
import { FestivalsModule } from './festivals/festivals.module';

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
    ScoresModule,
    DistrictsModule,
    FestivalsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
