import { isAxiosError } from 'axios';

type Translate = (scope: string) => string;

/** 백엔드 API 에러(axios)를 i18n 메시지로 매핑. 알 수 없는 상태코드는 fallbackKey로 폴백. */
export function getApiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  if (!isAxiosError(error)) return t(fallbackKey);
  if (!error.response) return t('auth.errors.networkError');

  switch (error.response.status) {
    case 401:
      return t('auth.errors.sessionExpired');
    // 백엔드가 403을 쓰는 곳은 register()의 이메일 인증 게이트뿐이다
    // (auth.service.ts). 다른 403이 생기면 이 매핑을 경로별로 나눠야 한다.
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
