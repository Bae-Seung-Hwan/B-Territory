import { Logger, ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { FirebaseService } from '../firebase/firebase.service';
import { UsersService } from '../../users/users.service';
import { ErrorCode, errBody } from '../errors/error-code';

/** 소켓 연결에 결합되는 인증 사용자 (핸드셰이크에서 확정). */
export interface AuthenticatedUser {
  id: string;
  team: string;
  nickname: string;
}

export type SocketData = { user?: AuthenticatedUser };

/**
 * WS 핸드셰이크 인증 — `handshake.auth.token`(Firebase ID 토큰)을 검증하고 팀이 배정된
 * 가입 유저인지 확인해 AuthenticatedUser를 돌려준다. 실패 시 throw(호출측이 disconnect).
 * realtime·chat 게이트웨이가 공유하는 단일 진입점.
 */
export async function authenticateSocket(
  firebaseService: FirebaseService,
  usersService: UsersService,
  client: Socket,
): Promise<AuthenticatedUser> {
  const token = client.handshake.auth?.token as string | undefined;
  if (!token) throw new Error('missing token');

  const decoded = await firebaseService.verifyIdToken(token);
  const user = await usersService.findByFirebaseUid(decoded.uid);
  if (!user || !user.team) throw new Error('unregistered user');

  return { id: user.id, team: user.team, nickname: user.nickname };
}

/**
 * 인증된 사용자 조회 — 미인증 소켓이면 WsException.
 * 에러코드는 realtime 게이트웨이에서 옮겨온 것이다 — 프론트가 code로 문구를 매핑하므로
 * 이 유틸을 쓰는 모든 게이트웨이(realtime·chat)가 같은 코드를 내야 한다.
 */
export function getSocketUser(client: Socket): AuthenticatedUser {
  const user = (client.data as SocketData).user;
  if (!user)
    throw new WsException(
      errBody(
        ErrorCode.UNAUTHENTICATED_CONNECTION,
        '인증되지 않은 연결입니다.',
      ),
    );
  return user;
}

export function setSocketUser(client: Socket, user: AuthenticatedUser): void {
  (client.data as SocketData).user = user;
}

/**
 * 네임스페이스 미들웨어로 핸드셰이크 인증을 건다 — 게이트웨이는 afterInit에서 호출한다.
 *
 * 라이프사이클 훅(handleConnection)에서 인증하면 안 된다. 그 훅은 전송 계층 연결이
 * 열린 뒤에 도는데, 클라이언트의 'connect'는 서버가 훅을 끝내길 기다리지 않고 즉시
 * 발생한다. 그 틈에 클라이언트가 메시지를 보내면 client.data.user가 아직 비어 있어
 * 정상 인증된 유저인데도 "인증되지 않은 연결"로 거부된다(접속 직후 전송 시 실측 ~60%).
 * 미들웨어는 핸드셰이크 자체의 일부라 완료 전에는 'connect'가 발생하지 않으므로,
 * 클라이언트 입장에서 "연결됨"이 곧 "인증됨"이 된다.
 *
 * onAuthenticated는 인증 직후 아직 핸드셰이크 안에서 처리할 일(예: 룸 join)을 받는다.
 * 여기서 클라이언트로 emit하면 안 된다 — 아직 연결 전이라 유실된다. 그런 작업은
 * handleConnection에 남긴다.
 */
export function useSocketAuth(
  namespace: Namespace,
  firebaseService: FirebaseService,
  usersService: UsersService,
  logger: Logger,
  onAuthenticated?: (
    socket: Socket,
    user: AuthenticatedUser,
  ) => void | Promise<void>,
): void {
  namespace.use((socket, next) => {
    void (async () => {
      // next()는 try 밖에서 부른다 — 안에서 부르면 next()가 동기적으로 실행하는 것이
      // 던졌을 때 아래 catch에 걸려 next()가 두 번 호출된다.
      let failure: Error | undefined;
      try {
        const user = await authenticateSocket(
          firebaseService,
          usersService,
          socket,
        );
        setSocketUser(socket, user);
        await onAuthenticated?.(socket, user);
      } catch (err) {
        failure = err as Error;
      }

      if (!failure) {
        next();
        return;
      }

      // next(err)로 넘기면 클라이언트는 connect가 아니라 connect_error를 받는다.
      //
      // 상세 사유는 로그에만 남기고 클라이언트에는 고정 문구를 보낸다 — socket.io는
      // 넘긴 Error의 message를 그대로 CONNECT_ERROR 패킷에 실어 보내므로(namespace.js),
      // 그대로 넘기면 토큰 검증 과정에서 터진 DB/Firebase 내부 에러(접속 실패 호스트·포트,
      // SQL 조각 등)가 미인증 상태의 아무에게나 노출된다.
      logger.warn(`연결 거부: ${failure.message}`);
      next(new Error('unauthorized'));
    })();
  });
}

// 클래스 레벨 @UsePipes로 적용하면 @ConnectedSocket()의 Socket 파라미터까지 검증 대상이 되어
// (whitelist+forbidNonWhitelisted 조합이 데코레이터 없는 Socket의 모든 속성을 "허용되지 않음"으로
// 판단해 예외) 모든 핸들러가 실패한다. @MessageBody() 파라미터에만 개별로 붙여 DTO만 검증한다.
export const wsValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
