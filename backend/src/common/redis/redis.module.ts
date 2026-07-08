// NOTE: feature/Bae/territory-claim에서 복사해온 파일. territory-claim이 develop에 머지되면
// 이 브랜치를 develop 기준으로 rebase하면서 중복 정의를 정리할 것.
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
