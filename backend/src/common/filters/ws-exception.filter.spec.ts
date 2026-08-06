import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsExceptionsFilter } from './ws-exception.filter';
import { ErrorCode, errBody } from '../errors/error-code';

interface EmitCall {
  event: string;
  payload: { code: string; message: string | string[] };
}

function makeHost(emitted: EmitCall[]): ArgumentsHost {
  const client = {
    emit: (event: string, payload: EmitCall['payload']) => {
      emitted.push({ event, payload });
    },
  };
  return {
    switchToWs: () => ({ getClient: () => client }),
  } as unknown as ArgumentsHost;
}

describe('WsExceptionsFilter', () => {
  let filter: WsExceptionsFilter;
  let emitted: EmitCall[];

  beforeEach(() => {
    filter = new WsExceptionsFilter();
    emitted = [];
  });

  it('HttpException(errBody)의 code/message를 exception 이벤트로 전달한다', () => {
    // duels.service가 던지는 형태 — 기본 WS 필터라면 "Internal server error"로 뭉개졌을 케이스
    filter.catch(
      new ConflictException(
        errBody(
          ErrorCode.DUEL_ALREADY_ACTIVE,
          '이미 진행 중인 결투가 있습니다.',
        ),
      ),
      makeHost(emitted),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('exception');
    expect(emitted[0].payload).toEqual({
      code: ErrorCode.DUEL_ALREADY_ACTIVE,
      message: '이미 진행 중인 결투가 있습니다.',
    });
  });

  it('code 없는 프레임워크 HttpException은 상태코드에서 code를 유도한다', () => {
    filter.catch(new BadRequestException('bad input'), makeHost(emitted));

    expect(emitted[0].payload.code).toBe('BAD_REQUEST');
  });

  it('WsException(errBody)의 code/message를 그대로 전달한다', () => {
    filter.catch(
      new WsException(
        errBody(
          ErrorCode.UNAUTHENTICATED_CONNECTION,
          '인증되지 않은 연결입니다.',
        ),
      ),
      makeHost(emitted),
    );

    expect(emitted[0].payload).toEqual({
      code: ErrorCode.UNAUTHENTICATED_CONNECTION,
      message: '인증되지 않은 연결입니다.',
    });
  });

  it('문자열 WsException은 WS_ERROR로 감싼다', () => {
    filter.catch(new WsException('plain error'), makeHost(emitted));

    expect(emitted[0].payload).toEqual({
      code: 'WS_ERROR',
      message: 'plain error',
    });
  });

  it('예상 못한 에러는 내부 정보 없이 INTERNAL_SERVER_ERROR로 일반화한다', () => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('null deref detail'), makeHost(emitted));

    expect(emitted[0].payload).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    // 실제 원인 문자열이 클라이언트로 새지 않아야 한다
    expect(JSON.stringify(emitted[0].payload)).not.toContain('null deref');
  });
});
