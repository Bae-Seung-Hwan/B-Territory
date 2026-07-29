import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearRegisterDraft,
  loadRegisterDraft,
  saveRegisterDraft,
} from '@/lib/register-draft';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('register-draft', () => {
  afterEach(() => jest.clearAllMocks());

  it('저장한 초안을 그대로 돌려준다', async () => {
    await saveRegisterDraft({ email: 'a@b.com', nickname: 'nick', nationality: 'KR' });

    const [key, raw] = mockedStorage.setItem.mock.calls[0];
    expect(key).toBe('register-draft');

    mockedStorage.getItem.mockResolvedValue(raw);
    await expect(loadRegisterDraft()).resolves.toEqual({
      email: 'a@b.com',
      nickname: 'nick',
      nationality: 'KR',
    });
  });

  it('비밀번호는 저장하지 않는다', async () => {
    await saveRegisterDraft({ email: 'a@b.com', nickname: 'nick', nationality: 'KR' });

    const [, raw] = mockedStorage.setItem.mock.calls[0];
    expect(raw).not.toMatch(/password/i);
  });

  it('모든 값이 비면 저장 대신 초안을 지운다', async () => {
    await saveRegisterDraft({ email: '', nickname: '', nationality: null });

    expect(mockedStorage.setItem).not.toHaveBeenCalled();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith('register-draft');
  });

  it('하루가 지난 초안은 되살리지 않고 지운다', async () => {
    mockedStorage.getItem.mockResolvedValue(
      JSON.stringify({
        email: 'a@b.com',
        nickname: 'nick',
        nationality: 'KR',
        savedAt: Date.now() - DAY_MS - 1000,
      }),
    );

    await expect(loadRegisterDraft()).resolves.toBeNull();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith('register-draft');
  });

  it('형식이 깨진 값은 버린다', async () => {
    mockedStorage.getItem.mockResolvedValue('not json');

    await expect(loadRegisterDraft()).resolves.toBeNull();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith('register-draft');
  });

  it('저장된 초안이 없으면 null을 돌려준다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);

    await expect(loadRegisterDraft()).resolves.toBeNull();
    expect(mockedStorage.removeItem).not.toHaveBeenCalled();
  });

  it('초안 삭제는 스토리지 키를 지운다', async () => {
    await clearRegisterDraft();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith('register-draft');
  });
});
