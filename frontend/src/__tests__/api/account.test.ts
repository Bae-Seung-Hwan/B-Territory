const mockDelete = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import { deleteAccount } from '@/api/account';

describe('deleteAccount', () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it('DELETE /api/users/me를 호출한다', async () => {
    mockDelete.mockResolvedValue({ data: undefined });

    await deleteAccount();

    expect(mockDelete).toHaveBeenCalledWith('/api/users/me');
  });

  it('실패하면 에러를 그대로 던진다', async () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    mockDelete.mockRejectedValue(err);

    await expect(deleteAccount()).rejects.toBe(err);
  });
});
