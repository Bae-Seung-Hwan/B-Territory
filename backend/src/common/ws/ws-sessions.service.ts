import { Injectable } from '@nestjs/common';
import { Namespace } from 'socket.io';

/**
 * 유저 단위 타겟팅용 룸. 게이트웨이가 핸드셰이크에서 join하고, 채팅 차단 필터의
 * `.except()`와 탈퇴 시 세션 종료가 이 이름으로 소켓을 찾는다.
 */
export function userRoomOf(userId: string): string {
  return `user:${userId}`;
}

/**
 * 열려 있는 소켓 세션을 유저 단위로 끊기 위한 레지스트리.
 *
 * 인증은 핸드셰이크에서 **한 번만** 하고 결과를 `client.data`에 캐시하므로(ws-auth),
 * 계정을 지워도 이미 열려 있는 소켓은 인증된 상태로 계속 살아 있다. 그대로 두면 탈퇴
 * 직후 그 소켓이 보낸 `location:update`가 방금 지운 geo 키를 되살려 탈퇴자가 다시
 * 결투 탐지에 잡히고(닉네임은 null), 팀 채팅에도 계속 글을 쓸 수 있다.
 *
 * 게이트웨이가 afterInit에서 자기 네임스페이스를 등록한다. 서비스가 게이트웨이를 직접
 * 주입하면 게이트웨이가 UsersService를 쓰는 탓에 모듈 순환이 생기므로 이 레지스트리를
 * 거친다.
 */
@Injectable()
export class WsSessionsService {
  private readonly namespaces = new Set<Namespace>();

  register(namespace: Namespace): void {
    this.namespaces.add(namespace);
  }

  /**
   * 해당 유저의 소켓을 등록된 모든 네임스페이스에서 끊는다. `close=true`로 전송 계층까지
   * 닫아 클라이언트가 같은 연결을 이어 쓰지 못하게 한다.
   *
   * 단일 인스턴스 전제다(realtime·chat과 동일). 스케일아웃으로 socket.io Redis 어댑터를
   * 붙이면 disconnectSockets가 다른 인스턴스의 소켓까지 자동으로 커버한다.
   */
  disconnectUser(userId: string): void {
    for (const namespace of this.namespaces) {
      namespace.in(userRoomOf(userId)).disconnectSockets(true);
    }
  }
}
