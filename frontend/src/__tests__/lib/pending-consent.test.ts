import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingConsent,
  loadPendingConsent,
  savePendingConsent,
} from '@/lib/pending-consent';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type ConsentSnapshot } from '@/legal';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const DAY_MS = 24 * 60 * 60 * 1000;

const snapshot: ConsentSnapshot = {
  consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
    document: key,
    version: LEGAL_DOCUMENTS[key].version,
  })),
  ageConfirmed: true,
};

/** 저장된 원본을 그대로 읽기 경로에 물린다 — 직렬화 형식까지 함께 검증된다. */
function storeRoundTrip() {
  const [, raw] = mockedStorage.setItem.mock.calls[0];
  mockedStorage.getItem.mockResolvedValue(raw);
}

describe('pending-consent', () => {
  afterEach(() => jest.clearAllMocks());

  it('저장한 동의를 그대로 돌려준다', async () => {
    await savePendingConsent(snapshot);

    const [key] = mockedStorage.setItem.mock.calls[0];
    expect(key).toBe('pending-consent');

    storeRoundTrip();
    await expect(loadPendingConsent()).resolves.toEqual(snapshot);
  });

  it('보관된 값이 없으면 null이다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await expect(loadPendingConsent()).resolves.toBeNull();
  });

  it('하루가 지나면 버린다', async () => {
    await savePendingConsent(snapshot);
    const [, raw] = mockedStorage.setItem.mock.calls[0];
    const stale = JSON.stringify({
      ...(JSON.parse(raw as string) as Record<string, unknown>),
      savedAt: Date.now() - DAY_MS - 1,
    });
    mockedStorage.getItem.mockResolvedValue(stale);

    await expect(loadPendingConsent()).resolves.toBeNull();
    expect(mockedStorage.removeItem).toHaveBeenCalled();
  });

  it('형식이 깨진 값은 버린다', async () => {
    mockedStorage.getItem.mockResolvedValue('{not json');

    await expect(loadPendingConsent()).resolves.toBeNull();
    expect(mockedStorage.removeItem).toHaveBeenCalled();
  });

  /**
   * 이 두 건이 이 모듈의 존재 이유에 가장 가깝다. 서버가 필수 문서를 스스로 정하므로,
   * 문서 목록이 바뀐 앱으로 업데이트된 뒤 옛 스냅샷을 그대로 보내면 400이 나고 그 400은
   * 이메일 인증까지 마친 Firebase 계정을 지운다(use-registration-flow.ts의 롤백 판정).
   */
  it('지금 앱이 요구하는 문서가 빠져 있으면 버린다 (문서가 추가된 뒤의 옛 스냅샷)', async () => {
    mockedStorage.getItem.mockResolvedValue(
      JSON.stringify({
        consents: snapshot.consents.slice(1),
        ageConfirmed: true,
        savedAt: Date.now(),
      }),
    );

    await expect(loadPendingConsent()).resolves.toBeNull();
    expect(mockedStorage.removeItem).toHaveBeenCalled();
  });

  it('지금 앱이 모르는 문서가 섞여 있으면 버린다 (문서가 삭제된 뒤의 옛 스냅샷)', async () => {
    mockedStorage.getItem.mockResolvedValue(
      JSON.stringify({
        consents: [...snapshot.consents, { document: 'marketing', version: '2026-09-07' }],
        ageConfirmed: true,
        savedAt: Date.now(),
      }),
    );

    await expect(loadPendingConsent()).resolves.toBeNull();
  });

  it('연령 확인이 없는 값은 버린다', async () => {
    mockedStorage.getItem.mockResolvedValue(
      JSON.stringify({ consents: snapshot.consents, ageConfirmed: false, savedAt: Date.now() }),
    );

    await expect(loadPendingConsent()).resolves.toBeNull();
  });

  /**
   * version은 대조하지 않는다 — 그 사이 문서가 개정됐다면 이용자가 실제로 읽고 동의한
   * 것은 옛 판본이고, 원장에는 그 값이 남아야 사실이다.
   */
  it('version이 지금 문서와 달라도 그대로 돌려준다', async () => {
    const older = snapshot.consents.map((item) => ({ ...item, version: '2026-01-01' }));
    mockedStorage.getItem.mockResolvedValue(
      JSON.stringify({ consents: older, ageConfirmed: true, savedAt: Date.now() }),
    );

    await expect(loadPendingConsent()).resolves.toEqual({ consents: older, ageConfirmed: true });
  });

  it('clear는 보관된 값을 지운다', async () => {
    await clearPendingConsent();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith('pending-consent');
  });
});
