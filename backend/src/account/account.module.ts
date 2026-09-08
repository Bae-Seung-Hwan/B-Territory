import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';
import { HallOfFameModule } from '../hall-of-fame/hall-of-fame.module';
import { WithdrawalArchiveService } from './withdrawal-archive.service';
import { ConsentArchive } from './entities/consent-archive.entity';
import { WithdrawnAccount } from './entities/withdrawn-account.entity';
import { Report } from '../moderation/entities/report.entity';

// 탈퇴는 users·duels·Firebase·Redis에 걸쳐 있다. 두 모듈을 여기서 한 방향으로만
// 끌어써서 UsersModule <-> DuelsModule 순환을 만들지 않는다.
// FirebaseModule·RedisModule·WsModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  // HallOfFameModule은 개인 랭킹 캐시(닉네임 포함)를 무효화하기 위해 쓴다.
  // forFeature는 탈퇴 시 동의·신고 기록을 가명으로 옮기는 보관 표들을 위한 것이다
  // (WithdrawalArchiveService). consents·moderation 두 도메인에 걸쳐 있어 어느 한쪽 모듈이
  // 아니라 이미 도메인 횡단인 이 모듈에 둔다.
  imports: [
    UsersModule,
    DuelsModule,
    HallOfFameModule,
    TypeOrmModule.forFeature([WithdrawnAccount, ConsentArchive, Report]),
  ],
  controllers: [AccountController],
  providers: [AccountService, WithdrawalArchiveService],
})
export class AccountModule {}
