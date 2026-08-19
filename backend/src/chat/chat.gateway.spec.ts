import { WsException } from '@nestjs/websockets';
import { ChatGateway } from './chat.gateway';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { WsExceptionsFilter } from '../common/filters/ws-exception.filter';
import { ErrorCode } from '../common/errors/error-code';

interface MockSocket {
  id: string;
  handshake: { auth: { token?: string } };
  data: { user?: { id: string; team: string; nickname: string } };
  join: jest.Mock;
  disconnect: jest.Mock;
  to: jest.Mock;
  roomEmit: jest.Mock;
}

function mockSocket(token?: string): MockSocket {
  const roomEmit = jest.fn();
  return {
    id: 'sock-1',
    handshake: { auth: { token } },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
    to: jest.fn(() => ({ emit: roomEmit })),
    roomEmit,
  };
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let firebase: { verifyIdToken: jest.Mock };
  let users: { findByFirebaseUid: jest.Mock };
  let redis: { consumeRateLimit: jest.Mock };

  beforeEach(() => {
    firebase = { verifyIdToken: jest.fn() };
    users = { findByFirebaseUid: jest.fn() };
    redis = { consumeRateLimit: jest.fn().mockResolvedValue(true) };
    gateway = new ChatGateway(
      firebase as unknown as FirebaseService,
      users as unknown as UsersService,
      redis as unknown as RedisService,
    );
  });

  describe('핸드셰이크 인증 (네임스페이스 미들웨어)', () => {
    type SocketMiddleware = (
      socket: unknown,
      next: (err?: Error) => void,
    ) => void;

    /** afterInit이 네임스페이스에 등록한 미들웨어를 꺼낸다. */
    const captureMiddleware = (): SocketMiddleware => {
      let captured: SocketMiddleware | undefined;
      const namespace = {
        use: (fn: SocketMiddleware) => {
          captured = fn;
        },
      };
      gateway.afterInit(namespace as never);
      if (!captured) throw new Error('afterInit이 미들웨어를 등록하지 않았다');
      return captured;
    };

    /** 미들웨어를 실제 호출 순서대로 돌리고 next에 넘어온 에러를 돌려준다. */
    const runMiddleware = (client: MockSocket) =>
      new Promise<Error | undefined>((resolve) => {
        captureMiddleware()(client, (err) => resolve(err));
      });

    it('인증 성공 시 팀 룸에 join하고 소켓에 유저를 심는다', async () => {
      firebase.verifyIdToken.mockResolvedValue({ uid: 'fuid' });
      users.findByFirebaseUid.mockResolvedValue({
        id: 'u1',
        team: 'A',
        nickname: '유저A',
      });
      const client = mockSocket('valid-token');

      const err = await runMiddleware(client);

      expect(err).toBeUndefined();
      expect(client.join).toHaveBeenCalledWith('team:A');
      expect(client.data.user).toEqual({
        id: 'u1',
        team: 'A',
        nickname: '유저A',
      });
    });

    it('next() 호출 시점엔 이미 인증·join이 끝나 있다 (접속 직후 전송 경합 방지)', async () => {
      // 이 순서가 이 수정의 핵심이다. 인증이 라이프사이클 훅에 있으면 클라이언트는
      // 인증 완료 전에 connect를 받아, 곧바로 보낸 메시지가 미인증으로 거부된다.
      firebase.verifyIdToken.mockResolvedValue({ uid: 'fuid' });
      users.findByFirebaseUid.mockResolvedValue({
        id: 'u1',
        team: 'A',
        nickname: '유저A',
      });
      const client = mockSocket('valid-token');
      const middleware = captureMiddleware();

      await new Promise<void>((resolve) => {
        middleware(client, () => {
          // next()가 불린 바로 그 순간의 상태를 본다.
          expect(client.data.user).toBeDefined();
          expect(client.join).toHaveBeenCalledWith('team:A');
          resolve();
        });
      });

      // 인증이 끝난 소켓이므로 메시지 핸들러가 거부하지 않는다.
      await expect(
        gateway.handleChatMessage(client as never, { text: '안녕' }),
      ).resolves.toEqual({ status: 'ok' });
    });

    it('토큰이 없으면 next(err)로 연결을 거부한다', async () => {
      const client = mockSocket(undefined);
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('팀 미배정 유저는 next(err)로 연결을 거부한다', async () => {
      firebase.verifyIdToken.mockResolvedValue({ uid: 'fuid' });
      users.findByFirebaseUid.mockResolvedValue({
        id: 'u1',
        team: '',
        nickname: 'x',
      });
      const client = mockSocket('valid-token');
      const err = await runMiddleware(client);
      expect(err).toBeInstanceOf(Error);
      expect(client.join).not.toHaveBeenCalled();
    });

    // 회귀 가드: socket.io는 next()에 넘긴 Error의 message를 CONNECT_ERROR 패킷에 그대로
    // 실어 보낸다. 내부 에러를 그대로 넘기면 미인증 상태의 누구나 DB 접속 정보 등을 본다.
    it('내부 에러 메시지를 클라이언트로 넘기지 않는다', async () => {
      const internal = 'connect ECONNREFUSED 10.0.1.5:5432';
      firebase.verifyIdToken.mockRejectedValue(new Error(internal));
      const warn = jest
        .spyOn(gateway['logger'], 'warn')
        .mockImplementation(() => undefined);

      const err = await runMiddleware(mockSocket('valid-token'));

      expect(err?.message).toBe('unauthorized');
      expect(err?.message).not.toContain('ECONNREFUSED');
      // 상세 사유는 서버 로그에는 남아야 한다.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(internal));
      warn.mockRestore();
    });
  });

  describe('메시지 릴레이', () => {
    it('chat:message를 발신자 제외 같은 팀 룸으로 릴레이한다', async () => {
      const client = mockSocket('t');
      client.data.user = { id: 'u1', team: 'A', nickname: '유저A' };

      await gateway.handleChatMessage(client as never, { text: '안녕' });

      expect(client.to).toHaveBeenCalledWith('team:A');
      expect(client.roomEmit).toHaveBeenCalledWith(
        'chat:message',
        expect.objectContaining({
          userId: 'u1',
          nickname: '유저A',
          team: 'A',
          text: '안녕',
        }),
      );
    });

    it('team:location을 같은 팀 룸으로 릴레이한다', async () => {
      const client = mockSocket('t');
      client.data.user = { id: 'u1', team: 'B', nickname: '유저B' };

      await gateway.handleTeamLocation(client as never, {
        lat: 35.1,
        lng: 129.0,
      });

      expect(client.to).toHaveBeenCalledWith('team:B');
      expect(client.roomEmit).toHaveBeenCalledWith(
        'team:location',
        expect.objectContaining({ userId: 'u1', lat: 35.1, lng: 129.0 }),
      );
    });

    it('레이트리밋 초과 시 릴레이하지 않고 예외', async () => {
      redis.consumeRateLimit.mockResolvedValue(false);
      const client = mockSocket('t');
      client.data.user = { id: 'u1', team: 'A', nickname: '유저A' };

      await expect(
        gateway.handleChatMessage(client as never, { text: '안녕' }),
      ).rejects.toThrow();
      expect(client.roomEmit).not.toHaveBeenCalled();
    });

    // 문자열로 던지면 필터가 code를 붙일 근거가 없어 WS_ERROR로 뭉개지고, 프론트가
    // 도배 차단을 다른 실패와 구분하지 못한다.
    it('레이트리밋 예외는 code가 있는 errBody로 던진다', async () => {
      redis.consumeRateLimit.mockResolvedValue(false);
      const client = mockSocket('t');
      client.data.user = { id: 'u1', team: 'A', nickname: '유저A' };

      const err: unknown = await gateway
        .handleChatMessage(client as never, { text: '안녕' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(WsException);
      expect((err as WsException).getError()).toMatchObject({
        code: ErrorCode.CHAT_RATE_LIMIT,
      });
    });

    it('인증되지 않은 소켓의 메시지는 예외', async () => {
      const client = mockSocket('t'); // data.user 미설정
      await expect(
        gateway.handleChatMessage(client as never, { text: 'x' }),
      ).rejects.toThrow();
    });
  });

  // 필터가 빠지면 NestJS 기본 필터가 `{ status, message, cause }`를 내보내 code가 사라진다.
  // 데코레이터 누락은 타입 검사에도 테스트에도 잡히지 않으므로 메타데이터로 고정한다.
  it('realtime과 동일하게 WsExceptionsFilter가 걸려 있다', () => {
    const filters =
      (Reflect.getMetadata('__exceptionFilters__', ChatGateway) as unknown[]) ??
      [];
    expect(filters).toContain(WsExceptionsFilter);
  });
});
