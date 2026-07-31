const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { getMe, registerUser } from '@/api/auth';

describe('getMe', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('정상 응답이면 프로필을 반환한다', async () => {
    const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };
    mockGet.mockResolvedValue({ data: profile });

    await expect(getMe()).resolves.toEqual(profile);
    expect(mockGet).toHaveBeenCalledWith('/api/auth/me');
  });

  it('404면 null을 반환한다 (미가입)', async () => {
    mockGet.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });

    await expect(getMe()).resolves.toBeNull();
  });

  it('404가 아닌 에러는 그대로 던진다', async () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    mockGet.mockRejectedValue(err);

    await expect(getMe()).rejects.toBe(err);
  });
});

describe('registerUser', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('닉네임/국적을 그대로 POST하고 프로필을 반환한다', async () => {
    const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };
    mockPost.mockResolvedValue({ data: profile });

    await expect(registerUser({ nickname: 'n', nationality: 'KR' })).resolves.toEqual(profile);
    expect(mockPost).toHaveBeenCalledWith('/api/auth/register', { nickname: 'n', nationality: 'KR' });
  });
});
