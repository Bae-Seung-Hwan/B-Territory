import { ChatGateway } from './chat.gateway';
import { FirebaseService } from '../common/firebase/firebase.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';

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

  describe('handleConnection', () => {
    it('인증 성공 시 팀 룸에 join하고 소켓에 유저를 심는다', async () => {
      firebase.verifyIdToken.mockResolvedValue({ uid: 'fuid' });
      users.findByFirebaseUid.mockResolvedValue({
        id: 'u1',
        team: 'A',
        nickname: '유저A',
      });
      const client = mockSocket('valid-token');

      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith('team:A');
      expect(client.data.user).toEqual({
        id: 'u1',
        team: 'A',
        nickname: '유저A',
      });
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('토큰이 없으면 연결을 끊는다', async () => {
      const client = mockSocket(undefined);
      await gateway.handleConnection(client as never);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('팀 미배정 유저는 연결을 끊는다', async () => {
      firebase.verifyIdToken.mockResolvedValue({ uid: 'fuid' });
      users.findByFirebaseUid.mockResolvedValue({
        id: 'u1',
        team: '',
        nickname: 'x',
      });
      const client = mockSocket('valid-token');
      await gateway.handleConnection(client as never);
      expect(client.disconnect).toHaveBeenCalledWith(true);
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

    it('인증되지 않은 소켓의 메시지는 예외', async () => {
      const client = mockSocket('t'); // data.user 미설정
      await expect(
        gateway.handleChatMessage(client as never, { text: 'x' }),
      ).rejects.toThrow();
    });
  });
});
