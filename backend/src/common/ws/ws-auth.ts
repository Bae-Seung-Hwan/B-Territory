import { ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
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

// 클래스 레벨 @UsePipes로 적용하면 @ConnectedSocket()의 Socket 파라미터까지 검증 대상이 되어
// (whitelist+forbidNonWhitelisted 조합이 데코레이터 없는 Socket의 모든 속성을 "허용되지 않음"으로
// 판단해 예외) 모든 핸들러가 실패한다. @MessageBody() 파라미터에만 개별로 붙여 DTO만 검증한다.
export const wsValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
