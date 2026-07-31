import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api-client';

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

export async function registerUser(payload: {
  nickname: string;
  nationality: string;
}): Promise<Profile> {
  const { data } = await apiClient.post<Profile>('/api/auth/register', payload);
  return data;
}
