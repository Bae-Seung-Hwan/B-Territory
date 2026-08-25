import { Namespace } from 'socket.io';
import { userRoomOf, WsSessionsService } from './ws-sessions.service';

/**
 * 탈퇴 후 세션 차단의 유일한 수단이다. 인증은 핸드셰이크에서 한 번만 하므로, 여기서
 * 끊지 못한 소켓은 계정이 사라진 뒤에도 인증된 채로 위치를 갱신하고 채팅을 쓴다.
 *
 * 게이트웨이가 realtime·chat 두 곳에서 register하므로, "등록된 모든 네임스페이스"가
 * 실제로 전부 불리는지가 이 서비스의 계약이다.
 */
describe('WsSessionsService', () => {
  function fakeNamespace() {
    const disconnectSockets = jest.fn();
    const inRoom = jest.fn(() => ({ disconnectSockets }));
    return {
      namespace: { in: inRoom } as unknown as Namespace,
      inRoom,
      disconnectSockets,
    };
  }

  it('등록된 모든 네임스페이스에서 해당 유저의 룸을 끊는다', () => {
    const service = new WsSessionsService();
    const realtime = fakeNamespace();
    const chat = fakeNamespace();
    service.register(realtime.namespace);
    service.register(chat.namespace);

    service.disconnectUser('user-1');

    // 게이트웨이가 핸드셰이크에서 join하는 것과 같은 룸 이름이어야 소켓이 잡힌다.
    expect(realtime.inRoom).toHaveBeenCalledWith(userRoomOf('user-1'));
    expect(chat.inRoom).toHaveBeenCalledWith(userRoomOf('user-1'));
    // close=true — 전송 계층까지 닫아 클라이언트가 같은 연결을 이어 쓰지 못하게 한다.
    expect(realtime.disconnectSockets).toHaveBeenCalledWith(true);
    expect(chat.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('같은 네임스페이스를 두 번 등록해도 한 번만 끊는다', () => {
    const service = new WsSessionsService();
    const realtime = fakeNamespace();
    service.register(realtime.namespace);
    service.register(realtime.namespace);

    service.disconnectUser('user-1');

    expect(realtime.inRoom).toHaveBeenCalledTimes(1);
  });

  it('등록된 네임스페이스가 없으면 아무것도 하지 않는다', () => {
    const service = new WsSessionsService();

    expect(() => service.disconnectUser('user-1')).not.toThrow();
  });

  it('룸 이름은 유저 id로 네임스페이스된다', () => {
    expect(userRoomOf('user-1')).toBe('user:user-1');
  });
});
