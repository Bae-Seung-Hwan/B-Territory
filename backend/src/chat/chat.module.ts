import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { UsersModule } from '../users/users.module';
import { ModerationModule } from '../moderation/moderation.module';

// FirebaseModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [UsersModule, ModerationModule],
  providers: [ChatGateway],
})
export class ChatModule {}
