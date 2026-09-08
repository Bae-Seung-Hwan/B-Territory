import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api-client';
import type { ConsentRecord } from '@/legal';

export interface Profile {
  id: string;
  email: string;
  nickname: string;
  nationality: string;
  team: string;
}

/** 가입 여부 확인 + 프로필 조회. 미가입(404)은 null로 흡수, 그 외 에러는 그대로 던짐. */
export async function getMe(): Promise<Profile | null> {
  try {
    const { data } = await apiClient.get<Profile>('/api/auth/me');
    return data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

/**
 * 가입. `consents`/`ageConfirmed`는 **선택 항목이 아니다** — 서버가 필수 목록을 스스로
 * 정하고(`CLIENT_CONSENT_DOCUMENTS`) 하나라도 빠지면 `CONSENT_INCOMPLETE`로 400을 준다.
 * 그 400은 use-registration-flow.ts의 롤백 판정에 걸려 Firebase 계정 삭제까지 이어지므로,
 * 이 페이로드는 호출부가 임의로 만들지 말고 동의 화면이 남긴 스냅샷을 그대로 실어야 한다
 * (`@/lib/pending-consent`).
 */
export async function registerUser(payload: {
  nickname: string;
  nationality: string;
  consents: ConsentRecord[];
  ageConfirmed: boolean;
}): Promise<Profile> {
  const { data } = await apiClient.post<Profile>('/api/auth/register', payload);
  return data;
}
