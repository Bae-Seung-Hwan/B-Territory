import { Global, Module } from '@nestjs/common';
import { WsSessionsService } from './ws-sessions.service';

// 게이트웨이(등록)와 탈퇴 처리(사용)가 서로 다른 모듈에 있고 양쪽 다 UsersModule을 거쳐
// 순환하기 쉬워, RedisModule·FirebaseModule과 같이 @Global로 둔다.
@Global()
@Module({
  providers: [WsSessionsService],
  exports: [WsSessionsService],
})
export class WsModule {}
