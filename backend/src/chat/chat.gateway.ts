import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { WsExceptionsFilter } from '../common/filters/ws-exception.filter';
import { ErrorCode, errBody } from '../common/errors/error-code';
import {
  getSocketUser,
  useSocketAuth,
  wsValidationPipe,
} from '../common/ws/ws-auth';
import {
  userRoomOf,
  WsSessionsService,
} from '../common/ws/ws-sessions.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ModerationService } from '../moderation/moderation.service';

// 릴레이 도배 방지 레이트리밋(고정 윈도우).
const MSG_LIMIT = 5;
const MSG_WINDOW_SEC = 5;

/**
 * 팀(국가) 채팅·위치 공유 게이트웨이. 핸드셰이크에서 인증하며 팀 룸에 join하고, 메시지/
 * 위치를 같은 팀에게 릴레이만 한다(DB 저장 없음). 인증은 realtime과 동일한 ws-auth를 공유한다.
 * 소켓은 disconnect 시 socket.io가 룸에서 자동 제거하므로 별도 정리가 필요 없다.
 *
 * NOTE(스케일아웃): 룸 릴레이가 인스턴스 로컬이므로 다중 인스턴스 배포 시에는
 * socket.io Redis 어댑터가 필요하다(realtime 게이트웨이와 동일한 단일 인스턴스 전제).
 * NOTE(위치): 팀원 간 위치 공유(team:location)는 v1에서 제외했다. 좌표를 다른 이용자에게
 * 릴레이하는 것은 위치정보법상 개인위치정보의 제3자 제공에 해당해, 사업자 신고서
 * (docs/lbs-service-description.md 6장 "제3자 제공하지 않습니다")와 충돌하고 제19조의
 * 사전 동의·매회 통보 의무가 따라붙는다. 결투 매칭용 좌표(realtime의 location:update)는
 * 서버가 매칭에만 쓰고 남에게 넘기지 않아 해당되지 않는다. 재도입 시 신고서 변경과
 * 동의 절차 설계가 선행되어야 한다.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
// realtime 게이트웨이와 같은 필터를 건다. 없으면 NestJS 기본 필터가 예외를
// `{ status, message, cause }`로 내보내 code 필드가 빠지는데, 프론트는 code로 문구를
// 매핑하므로 이 게이트웨이의 실패만 분기할 수 없게 된다.
@UseFilters(WsExceptionsFilter)
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly moderation: ModerationService,
    private readonly sessions: WsSessionsService,
  ) {}

  /**
   * 발신자를 차단한 팀원의 **룸 이름** 목록. 릴레이에서 `.except()`로 제외한다.
   *
   * 차단을 클라이언트 필터링에만 맡기지 않는 이유는, 그 경우 차단한 상대의 메시지가
   * 여전히 기기까지 도달하기 때문이다. 서버에서 끊으면 실제로 전달되지 않는다.
   *
   * 소켓 Map을 순회하지 않는다 — 순회하면 차단자가 한 명이라도 있는 순간 매 메시지마다
   * 네임스페이스 전체를 훑게 되어(O(접속자수 × 메시지수)), 하필 괴롭힘을 당해 차단을
   * 걸어둔 이용자에게서 가장 느려진다. 핸드셰이크에서 각 소켓을 user:<id> 룸에 넣어두고
   * 그 이름을 그대로 넘겨 socket.io가 처리하게 한다(O(차단자수)).
   */
  private async blockerRooms(senderId: string): Promise<string[]> {
    const blockerIds = await this.moderation.getBlockedBy(senderId);
    return blockerIds.map((id) => userRoomOf(id));
  }

  private roomOf(team: string): string {
    return `team:${team}`;
  }

  /**
   * 레이트리밋 초과 시 WsException.
   *
   * 에러는 문자열이 아니라 errBody 객체로 던진다 — 문자열이면 필터가 code를 붙일 근거가
   * 없어 일반값(WS_ERROR)으로 뭉개지고, 프론트가 "도배 차단"을 다른 실패와 구분할 수 없다.
   */
  private async assertRate(
    kind: string,
    userId: string,
    limit: number,
    windowSec: number,
  ): Promise<void> {
    // Redis 장애는 통과시킨다(fail-open). 레이트리밋은 도배 방지용 편의 장치인데,
    // 여기서 예외가 새면 Redis가 죽어 있는 동안 모든 메시지가 실패해 채팅이 통째로
    // 멈춘다 — 도배보다 서비스 중단이 훨씬 나쁘다.
    let allowed = true;
    try {
      allowed = await this.redis.consumeRateLimit(
        `chat:rate:${kind}:${userId}`,
        limit,
        windowSec,
      );
    } catch (err) {
      this.logger.warn(
        `레이트리밋 확인 실패, 통과시킴: ${(err as Error).message}`,
      );
    }
    if (!allowed) {
      throw new WsException(
        errBody(
          ErrorCode.CHAT_RATE_LIMIT,
          '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.',
        ),
      );
    }
  }

  /**
   * 인증과 팀 룸 join을 모두 핸드셰이크 안에서 끝낸다 — 클라이언트가 connect를 받은
   * 시점엔 이미 인증·join이 완료돼 있어, 접속 직후 보낸 메시지가 거부되거나 접속 직후
   * 팀 메시지를 놓치는 창이 없다.
   */
  afterInit(namespace: Namespace): void {
    // 탈퇴 시 이 유저의 소켓을 끊을 수 있도록 네임스페이스를 등록한다.
    this.sessions.register(namespace);
    useSocketAuth(
      namespace,
      this.firebaseService,
      this.usersService,
      this.logger,
      // await한다 — join이 핸드셰이크 안에서 끝나야 connect 직후 도착한 메시지를 놓치지 않고,
      // 차단 제외도 첫 메시지부터 적용된다.
      async (socket, user) => {
        await socket.join(this.roomOf(user.team));
        // 차단 필터가 이 룸 이름으로 수신자를 제외하고(blockerRooms 참고),
        // 탈퇴 시 세션 종료도 이 룸으로 소켓을 찾는다.
        await socket.join(userRoomOf(user.id));
      },
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
    // 발신자를 차단한 팀원도 제외한다 — 차단은 서버에서 끊어야 실제로 전달되지 않는다.
    const excluded = await this.blockerRooms(user.id);
    client.to(this.roomOf(user.team)).except(excluded).emit('chat:message', {
      userId: user.id,
      nickname: user.nickname,
      team: user.team,
      text: dto.text,
      at: new Date().toISOString(),
    });
    return { status: 'ok' };
  }
}
