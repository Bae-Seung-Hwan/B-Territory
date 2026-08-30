import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearVisitCheckin, loadVisitCheckin, saveVisitCheckin } from '@/lib/visit-checkin';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('visit-checkin', () => {
  afterEach(() => jest.clearAllMocks());

  it('체크인을 저장하면 해당 spotId가 유효로 조회된다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await saveVisitCheckin(1, 3600);

    const [, raw] = mockedStorage.setItem.mock.calls[0];
    mockedStorage.getItem.mockResolvedValue(raw);
    await expect(loadVisitCheckin(1)).resolves.toBe(true);
  });

  it('체크인한 적 없는 spotId는 유효하지 않다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await expect(loadVisitCheckin(1)).resolves.toBe(false);
  });

  it('만료된 체크인은 유효하지 않다', async () => {
    mockedStorage.getItem.mockResolvedValue(JSON.stringify({ 1: Date.now() - 1000 }));
    await expect(loadVisitCheckin(1)).resolves.toBe(false);
  });

  it('한 관광지의 체크인이 다른 관광지에는 영향을 주지 않는다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await saveVisitCheckin(1, 3600);

    const [, raw] = mockedStorage.setItem.mock.calls[0];
    mockedStorage.getItem.mockResolvedValue(raw);
    await expect(loadVisitCheckin(2)).resolves.toBe(false);
  });

  it('두 관광지에 각각 체크인해도 서로 유지된다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await saveVisitCheckin(1, 3600);
    let raw = mockedStorage.setItem.mock.calls[0][1];

    mockedStorage.getItem.mockResolvedValue(raw);
    await saveVisitCheckin(2, 3600);
    raw = mockedStorage.setItem.mock.calls[1][1];

    mockedStorage.getItem.mockResolvedValue(raw);
    await expect(loadVisitCheckin(1)).resolves.toBe(true);
    await expect(loadVisitCheckin(2)).resolves.toBe(true);
  });

  it('삭제하면 해당 spotId만 지워진다', async () => {
    mockedStorage.getItem.mockResolvedValue(JSON.stringify({ 1: Date.now() + 3600_000, 2: Date.now() + 3600_000 }));
    await clearVisitCheckin(1);

    const [, raw] = mockedStorage.setItem.mock.calls[0];
    expect(JSON.parse(raw)).toEqual({ 2: expect.any(Number) });
  });

  it('마지막 남은 체크인을 지우면 스토리지 키 자체를 지운다', async () => {
    mockedStorage.getItem.mockResolvedValue(JSON.stringify({ 1: Date.now() + 3600_000 }));
    await clearVisitCheckin(1);

    expect(mockedStorage.removeItem).toHaveBeenCalledWith('visit-checkin');
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
  });

  it('형식이 깨진 값은 빈 상태로 취급한다', async () => {
    mockedStorage.getItem.mockResolvedValue('not json');
    await expect(loadVisitCheckin(1)).resolves.toBe(false);
  });
});
