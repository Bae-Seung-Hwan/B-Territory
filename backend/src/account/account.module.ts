import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';
import { HallOfFameModule } from '../hall-of-fame/hall-of-fame.module';

// 탈퇴는 users·duels·Firebase·Redis에 걸쳐 있다. 두 모듈을 여기서 한 방향으로만
// 끌어써서 UsersModule <-> DuelsModule 순환을 만들지 않는다.
// FirebaseModule·RedisModule·WsModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  // HallOfFameModule은 개인 랭킹 캐시(닉네임 포함)를 무효화하기 위해 쓴다.
  imports: [UsersModule, DuelsModule, HallOfFameModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
