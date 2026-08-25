const getIdToken = jest.fn();

jest.mock('@/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
}));

let mockCurrentUser: { getIdToken: typeof getIdToken } | null = { getIdToken };

import { apiClient } from '@/lib/api-client';

describe('apiClient request interceptor', () => {
  beforeEach(() => {
    getIdToken.mockReset();
    mockCurrentUser = { getIdToken };
  });

  it('로그인된 사용자가 있으면 Authorization 헤더를 첨부한다', async () => {
    getIdToken.mockResolvedValue('token-123');
    const config = await apiClient.interceptors.request.handlers[0].fulfilled({
      headers: {},
    });
    expect(config.headers.Authorization).toBe('Bearer token-123');
    expect(getIdToken).toHaveBeenCalledWith();
  });

  it('로그인된 사용자가 없으면 Authorization 헤더를 첨부하지 않는다', async () => {
    mockCurrentUser = null;
    const config = await apiClient.interceptors.request.handlers[0].fulfilled({
      headers: {},
    });
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe('apiClient response interceptor', () => {
  beforeEach(() => {
    getIdToken.mockReset();
    mockCurrentUser = { getIdToken };
  });

  it('401 응답에 강제 토큰 갱신 후 원요청을 1회 재시도한다', async () => {
    getIdToken.mockResolvedValue('fresh-token');
    const retried = { status: 200, data: 'ok' };
    const requestSpy = jest.spyOn(apiClient, 'request').mockResolvedValueOnce(retried as never);

    const originalConfig = { headers: {}, _retry: false };
    const error = {
      config: originalConfig,
      response: { status: 401 },
      isAxiosError: true,
    };

    const result = await apiClient.interceptors.response.handlers[0].rejected(error);

    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(originalConfig._retry).toBe(true);
    expect(originalConfig.headers.Authorization).toBe('Bearer fresh-token');
    expect(requestSpy).toHaveBeenCalledWith(originalConfig);
    expect(result).toBe(retried);

    requestSpy.mockRestore();
  });

  it('재시도한 요청도 401이면 무한루프 없이 그대로 reject한다', async () => {
    const originalConfig = { headers: {}, _retry: true };
    const error = {
      config: originalConfig,
      response: { status: 401 },
      isAxiosError: true,
    };

    await expect(apiClient.interceptors.response.handlers[0].rejected(error)).rejects.toBe(error);
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it('로그인된 사용자가 없으면 갱신을 시도하지 않고 reject한다', async () => {
    mockCurrentUser = null;
    const error = {
      config: { headers: {}, _retry: false },
      response: { status: 401 },
      isAxiosError: true,
    };

    await expect(apiClient.interceptors.response.handlers[0].rejected(error)).rejects.toBe(error);
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it('401이 아닌 에러는 그대로 reject한다', async () => {
    const error = {
      config: { headers: {}, _retry: false },
      response: { status: 500 },
      isAxiosError: true,
    };

    await expect(apiClient.interceptors.response.handlers[0].rejected(error)).rejects.toBe(error);
    expect(getIdToken).not.toHaveBeenCalled();
  });
});
