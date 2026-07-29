import { apiClient } from '@/lib/api-client';

export interface VerifyTokenResult {
  email: string;
  verified: true;
}

/**
 * 이메일 인증 매직 링크 발송. 백엔드가 60초 재발송 쿨다운을 걸어 `429`를 던진다.
 * 인증 사실은 서버(Redis)에 이메일 기준으로 30분간 남으므로, 링크를 어느 기기/브라우저에서
 * 열었든 같은 이메일로 가입하면 인정된다.
 */
export async function sendVerificationLink(email: string): Promise<void> {
  await apiClient.post('/api/email/send-link', { email });
}

/** 매직 링크의 token 검증. 토큰은 1회용이라 성공하든 실패하든 재사용할 수 없다. */
export async function verifyEmailToken(token: string): Promise<VerifyTokenResult> {
  const { data } = await apiClient.post<VerifyTokenResult>('/api/email/verify-token', { token });
  return data;
}
