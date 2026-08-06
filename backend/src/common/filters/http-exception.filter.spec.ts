import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { ErrorCode, errBody } from '../errors/error-code';

interface JsonResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  error: string;
}

function makeHttpHost(captured: { status?: number; body?: JsonResponse }) {
  const response = {
    status(code: number) {
      captured.status = code;
      return {
        json(body: JsonResponse) {
          captured.body = body;
        },
      };
    },
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('errBody로 던진 예외의 code/statusCode/message를 그대로 통일한다', () => {
    const captured: { status?: number; body?: JsonResponse } = {};
    filter.catch(
      new NotFoundException(
        errBody(ErrorCode.SPOT_NOT_FOUND, '관광지를 찾을 수 없습니다.'),
      ),
      makeHttpHost(captured),
    );

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({
      statusCode: 404,
      code: ErrorCode.SPOT_NOT_FOUND,
      message: '관광지를 찾을 수 없습니다.',
    });
  });

  it('code 없는 프레임워크 예외는 상태코드에서 code를 유도한다', () => {
    const captured: { status?: number; body?: JsonResponse } = {};
    filter.catch(new BadRequestException('bad input'), makeHttpHost(captured));

    expect(captured.status).toBe(400);
    expect(captured.body?.code).toBe('BAD_REQUEST');
  });

  it('HttpException이 아닌 예상 못한 에러도 500 INTERNAL_SERVER_ERROR로 통일한다', () => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    const captured: { status?: number; body?: JsonResponse } = {};
    filter.catch(
      new Error('db connection lost detail'),
      makeHttpHost(captured),
    );

    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    // 내부 원인 문자열이 클라이언트로 새지 않아야 한다
    expect(JSON.stringify(captured.body)).not.toContain('db connection lost');
  });

  it('비-HTTP 컨텍스트에서는 재던져 기본 처리에 위임한다', () => {
    const host = {
      getType: () => 'ws',
    } as unknown as ArgumentsHost;
    const err = new NotFoundException('x');

    expect(() => filter.catch(err, host)).toThrow(err);
  });
});
