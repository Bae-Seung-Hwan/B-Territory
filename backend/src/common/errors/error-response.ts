import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'http';

/** 통일된 에러 응답 본문. 프론트는 machine-readable `code`로 다국어 문구를 매핑한다. */
export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  error: string;
}

/**
 * HttpException을 `{ statusCode, code, message, error }`로 정규화한다.
 * HTTP 필터(응답 본문)와 WS 필터(exception 이벤트)가 공용으로 써서 두 경로가 같은 규칙으로
 * code/message를 뽑도록 한다.
 *
 * - errBody(ErrorCode.X, msg)로 던진 예외는 그 `code`를 그대로 싣는다.
 * - class-validator(ValidationPipe) 등 프레임워크 예외는 code가 없으므로 상태코드에서
 *   유도한 값(예: 400 → BAD_REQUEST)을 채운다.
 */
export function httpExceptionToBody(
  exception: HttpException,
): ApiErrorResponse {
  const status = exception.getStatus();
  const res = exception.getResponse();
  const reason = STATUS_CODES[status] ?? 'Error';
  const fallbackCode = reason.toUpperCase().replace(/\s+/g, '_');

  if (typeof res === 'string') {
    return {
      statusCode: status,
      code: fallbackCode,
      message: res,
      error: reason,
    };
  }

  const r = res as {
    message?: string | string[];
    error?: string;
    code?: string;
  };
  return {
    statusCode: status,
    code: r.code ?? fallbackCode,
    message: r.message ?? exception.message,
    error: r.error ?? reason,
  };
}
