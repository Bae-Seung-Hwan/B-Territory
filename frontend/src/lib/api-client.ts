import { create, isAxiosError } from 'axios';
import { auth } from '@/lib/firebase';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

export const apiClient = create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await auth.currentUser?.getIdToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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
        const freshToken = await auth.currentUser.getIdToken(true);
        original.headers.Authorization = `Bearer ${freshToken}`;
        return apiClient.request(original);
      } catch {
        // 토큰 갱신 자체가 실패하면 원래 401 에러로 reject
      }
    }
    return Promise.reject(error);
  },
);
