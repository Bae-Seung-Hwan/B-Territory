import { isAxiosError } from 'axios';

type Translate = (scope: string) => string;

/** 백엔드 API 에러(axios)를 i18n 메시지로 매핑. 알 수 없는 상태코드는 fallbackKey로 폴백. */
export function getApiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  if (!isAxiosError(error)) return t(fallbackKey);
  if (!error.response) return t('auth.errors.networkError');

  switch (error.response.status) {
    case 401:
      return t('auth.errors.sessionExpired');
    case 409:
      return t('auth.errors.alreadyRegistered');
    default:
      return t(fallbackKey);
  }
}
