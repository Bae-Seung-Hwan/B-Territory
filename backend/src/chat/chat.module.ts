import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { UsersModule } from '../users/users.module';

// FirebaseModule은 @Global이라 별도 import 없이 주입된다.
@Module({
  imports: [UsersModule],
  providers: [ChatGateway],
})
export class ChatModule {}
