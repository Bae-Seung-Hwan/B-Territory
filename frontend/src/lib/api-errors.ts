import { isAxiosError } from 'axios';

type Translate = (scope: string) => string;

/**
 * 백엔드 HttpExceptionFilter가 내려주는 machine-readable 에러 코드(예: EMAIL_NOT_VERIFIED).
 * 이 코드는 PR #30(에러코드 표준화)부터 응답 본문에 실린다 — 그 전 백엔드는 필드 자체가
 * 없으므로 항상 null이 반환되고, 호출부는 상태 코드 기반 폴백으로 넘어간다.
 */
export function getApiErrorCode(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/** 백엔드 API 에러(axios)를 i18n 메시지로 매핑. 알 수 없는 상태코드는 fallbackKey로 폴백. */
export function getApiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  if (!isAxiosError(error)) return t(fallbackKey);
  if (!error.response) return t('auth.errors.networkError');

  // code가 있으면(PR #30 이후 백엔드) 상태 코드보다 우선한다 — 지금은 403이 이메일 인증
  // 게이트 하나뿐이라 안 갈리지만, code 기반으로 두면 403을 쓰는 경로가 늘어나도 안전하다.
  if (getApiErrorCode(error) === 'EMAIL_NOT_VERIFIED') {
    return t('auth.errors.emailVerificationRequired');
  }

  switch (error.response.status) {
    case 401:
      return t('auth.errors.sessionExpired');
    // code가 없는 구 백엔드용 폴백. 지금 403을 쓰는 곳은 register()의 이메일 인증 게이트뿐이다
    // (auth.service.ts). 다른 403이 생기면(그리고 code도 안 실려 있으면) 이 매핑을 나눠야 한다.
    case 403:
      return t('auth.errors.emailVerificationRequired');
    case 409:
      return t('auth.errors.alreadyRegistered');
    case 429:
      return t('auth.errors.tooManyRequests');
    default:
      return t(fallbackKey);
  }
}
