import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { httpExceptionToBody } from '../errors/error-response';

interface WsErrorPayload {
  code: string;
  message: string | string[];
}

/**
 * WebSocket 핸들러(@SubscribeMessage)에서 던진 예외를 클라이언트가 읽을 수 있는
 * `exception` 이벤트(`{ code, message }`)로 변환한다.
 *
 * 배경: duels.service 등은 도메인 예외를 HttpException(errBody(code,msg) 포함)으로 던지는데,
 * NestJS 기본 BaseWsExceptionFilter는 WsException이 아닌 예외를 전부 "Internal server error"
 * 한 문장으로 뭉개버려 code가 유실된다(프론트가 "같은 팀"인지 "이미 결투 중"인지 구분 불가).
 * 이 필터가 HttpException·WsException 양쪽에서 { code, message }를 뽑아 그대로 전달한다.
 *
 * 게이트웨이에 @UseFilters로 스코프한다 — @Catch() catch-all이라 전역 등록하면 HTTP 에러까지
 * 가로채 HttpExceptionFilter와 충돌하기 때문이다.
 *
 * 주의: NestJS에서 핸들러가 throw로 끝나면 클라이언트의 emit(..., ack) 콜백은 호출되지 않는다.
 * 클라이언트는 `exception` 이벤트를 구독해 실패를 처리해야 한다.
 */
@Catch()
export class WsExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    client.emit('exception', this.toPayload(exception));
  }

  private toPayload(exception: unknown): WsErrorPayload {
    if (exception instanceof HttpException) {
      const { code, message } = httpExceptionToBody(exception);
      return { code, message };
    }

    if (exception instanceof WsException) {
      const err = exception.getError();
      if (typeof err === 'string') return { code: 'WS_ERROR', message: err };
      const e = err as { code?: string; message?: string | string[] };
      return {
        code: e.code ?? 'WS_ERROR',
        message: e.message ?? 'WebSocket error',
      };
    }

    // 예상 못한 에러: 원인은 서버 로그에만, 클라이언트엔 일반화된 코드만.
    this.logger.error('Unhandled WS exception', exception as Error);
    return { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
  }
}
