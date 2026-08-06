import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import {
  getSocketUser,
  useSocketAuth,
  wsValidationPipe,
} from '../common/ws/ws-auth';
import { ChatMessageDto } from './dto/chat-message.dto';
import { TeamLocationDto } from './dto/team-location.dto';

// 릴레이 도배 방지 레이트리밋(고정 윈도우). 위치는 GPS 갱신이라 좀 더 여유롭게.
const MSG_LIMIT = 5;
const MSG_WINDOW_SEC = 5;
const LOC_LIMIT = 10;
const LOC_WINDOW_SEC = 10;

/**
 * 팀(국가) 채팅·위치 공유 게이트웨이. 핸드셰이크에서 인증하며 팀 룸에 join하고, 메시지/
 * 위치를 같은 팀에게 릴레이만 한다(DB 저장 없음). 인증은 realtime과 동일한 ws-auth를 공유한다.
 * 소켓은 disconnect 시 socket.io가 룸에서 자동 제거하므로 별도 정리가 필요 없다.
 *
 * NOTE(스케일아웃): 룸 릴레이가 인스턴스 로컬이므로 다중 인스턴스 배포 시에는
 * socket.io Redis 어댑터가 필요하다(realtime 게이트웨이와 동일한 단일 인스턴스 전제).
 * NOTE(위치): team:location은 결투 탐지용 realtime의 location:update와 목적·수신자가
 * 달라 별도 채널로 둔다. 프론트는 두 채널에 위치를 중복 전송하지 않도록 조율한다.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  private roomOf(team: string): string {
    return `team:${team}`;
  }

  /** 레이트리밋 초과 시 WsException. */
  private async assertRate(
    kind: string,
    userId: string,
    limit: number,
    windowSec: number,
  ): Promise<void> {
    const allowed = await this.redis.consumeRateLimit(
      `chat:rate:${kind}:${userId}`,
      limit,
      windowSec,
    );
    if (!allowed) {
      throw new WsException('요청이 너무 잦습니다. 잠시 후 다시 시도하세요.');
    }
  }

  /**
   * 인증과 팀 룸 join을 모두 핸드셰이크 안에서 끝낸다 — 클라이언트가 connect를 받은
   * 시점엔 이미 인증·join이 완료돼 있어, 접속 직후 보낸 메시지가 거부되거나 접속 직후
   * 팀 메시지를 놓치는 창이 없다.
   */
  afterInit(namespace: Namespace): void {
    useSocketAuth(
      namespace,
      this.firebaseService,
      this.usersService,
      this.logger,
      (socket, user) => socket.join(this.roomOf(user.team)),
    );
  }

  @SubscribeMessage('chat:message')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: ChatMessageDto,
  ) {
    const user = getSocketUser(client);
    await this.assertRate('msg', user.id, MSG_LIMIT, MSG_WINDOW_SEC);
    // 발신자를 제외한 같은 팀에게만 릴레이 (발신자는 낙관적 UI로 자기 메시지를 이미 표시).
    client.to(this.roomOf(user.team)).emit('chat:message', {
      userId: user.id,
      nickname: user.nickname,
      team: user.team,
      text: dto.text,
      at: new Date().toISOString(),
    });
    return { status: 'ok' };
  }

  @SubscribeMessage('team:location')
  async handleTeamLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody(wsValidationPipe) dto: TeamLocationDto,
  ) {
    const user = getSocketUser(client);
    await this.assertRate('loc', user.id, LOC_LIMIT, LOC_WINDOW_SEC);
    client.to(this.roomOf(user.team)).emit('team:location', {
      userId: user.id,
      nickname: user.nickname,
      lat: dto.lat,
      lng: dto.lng,
      at: new Date().toISOString(),
    });
    return { status: 'ok' };
  }
}
