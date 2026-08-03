import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { httpExceptionToBody } from '../errors/error-response';

/**
 * 모든 HTTP 에러 응답을 `{ statusCode, code, message, error }`로 통일한다.
 *
 * - 서비스가 errBody(ErrorCode.X, msg)로 던진 HttpException은 그 `code`를 그대로 싣는다.
 * - class-validator(ValidationPipe) 등 프레임워크가 만든 HttpException은 상태코드에서
 *   유도한 code(예: 400 → BAD_REQUEST)를 채운다.
 * - HttpException이 아닌 예상 못한 에러(널 참조, DB 순단 등)도 catch-all로 잡아 500 +
 *   `INTERNAL_SERVER_ERROR`로 통일한다. 상세 예외는 서버 로그에만 남기고 클라이언트엔
 *   내부 정보를 노출하지 않는다. 이로써 프론트는 **어떤 HTTP 에러든** code를 읽을 수 있다.
 *
 * WS 컨텍스트의 예외는 게이트웨이에 스코프된 WsExceptionsFilter가 먼저 처리한다. 혹시
 * 비-HTTP 컨텍스트로 여기까지 오면 HTTP 응답을 쓸 수 없으므로 재던져 기본 처리에 맡긴다.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;

    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = httpExceptionToBody(exception);
      response.status(body.statusCode).json(body);
      return;
    }

    // 예상 못한 에러: 원인은 서버 로그에만 남기고, 클라이언트엔 일반화된 500만 내려보낸다.
    this.logger.error('Unhandled exception', exception as Error);
    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }
}
