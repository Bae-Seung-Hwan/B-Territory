import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Response } from 'express';

/**
 * HTTP 에러 응답을 `{ statusCode, code, message, error }`로 통일한다.
 *
 * - 서비스가 errBody(ErrorCode.X, msg)로 던진 예외는 그 `code`를 그대로 싣는다.
 * - class-validator(ValidationPipe) 등 프레임워크가 만든 예외는 `code`가 없으므로
 *   상태코드에서 유도한 값(예: 400 → BAD_REQUEST)을 채워, 프론트가 어떤 에러든
 *   항상 `code`를 읽을 수 있게 한다.
 * - message/error(문자열 또는 배열)는 기존 동작을 보존한다.
 *
 * WsException은 HttpException을 상속하지 않으므로 이 필터에 걸리지 않는다(게이트웨이의
 * 기본 WS 처리에 그대로 위임).
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    // HTTP가 아닌 컨텍스트(WS 등)에서 HttpException이 올라온 경우 HTTP 응답을 쓰면 안 되므로
    // 재던져 기본 처리에 맡긴다.
    if (host.getType() !== 'http') throw exception;

    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const res = exception.getResponse();

    let code: string | undefined;
    let message: string | string[];
    let error: string | undefined;

    if (typeof res === 'string') {
      message = res;
    } else {
      const r = res as {
        message?: string | string[];
        error?: string;
        code?: string;
      };
      message = r.message ?? exception.message;
      error = r.error;
      code = r.code;
    }

    const reason = STATUS_CODES[status] ?? 'Error';
    response.status(status).json({
      statusCode: status,
      code: code ?? reason.toUpperCase().replace(/\s+/g, '_'),
      message,
      error: error ?? reason,
    });
  }
}
