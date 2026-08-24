import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { UsersModule } from '../users/users.module';
import { DuelsModule } from '../duels/duels.module';

// 탈퇴는 users·duels·Firebase·Redis에 걸쳐 있다. 두 모듈을 여기서 한 방향으로만
// 끌어써서 UsersModule <-> DuelsModule 순환을 만들지 않는다.
// FirebaseModule·RedisModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [UsersModule, DuelsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
