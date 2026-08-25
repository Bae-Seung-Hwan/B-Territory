import { create, isAxiosError } from 'axios';
import { auth } from '@/lib/firebase';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

// API 주소의 단일 소스. 예전엔 이 식이 api/spots.ts·api/claims.ts에도 복사돼 있었고,
// 그쪽에만 로컬 폴백이 있어 env를 빠뜨렸을 때 인증 요청만 조용히 실패하는 상태였다.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const apiClient = create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await auth.currentUser?.getIdToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 토큰 만료 시점에 여러 요청이 동시에 401을 받아도 갱신 요청은 하나만 나가도록
// 진행 중인 갱신 Promise를 공유한다(single-flight).
let refreshPromise: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (
      isAxiosError(error) &&
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      auth.currentUser
    ) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = auth.currentUser.getIdToken(true).finally(() => {
            refreshPromise = null;
          });
        }
        const freshToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${freshToken}`;
        return apiClient.request(original);
      } catch {
        // 토큰 갱신 자체가 실패하면 원래 401 에러로 reject
      }
    }
    return Promise.reject(error);
  },
);
