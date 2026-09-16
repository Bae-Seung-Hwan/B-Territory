import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERMISSION_NOTICE_VERSION } from '@/constants/app-permissions';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/**
 * 모듈 스코프에 확인 여부를 캐시하는 스토어라(같은 실행 안에서 저장소를 두 번 읽지 않는다),
 * 시나리오마다 모듈을 새로 로드해 "앱을 새로 켠" 상태에서 시작한다.
 */
function freshModule(): typeof import('@/lib/permission-notice') {
  let mod!: typeof import('@/lib/permission-notice');
  jest.isolateModules(() => {
    mod = require('@/lib/permission-notice');
  });
  return mod;
}

describe('permission-notice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.setItem.mockResolvedValue(undefined);
  });

  it('확인 기록이 없으면 pending — 첫 실행에는 고지 화면이 떠야 한다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    const { ensurePermissionNoticeLoaded, getPermissionNoticeState, isPermissionNoticeAcknowledged } =
      freshModule();

    // 저장소를 읽기 전에는 pending도 acknowledged도 아니다 — 고지 화면이 깜빡이지 않고,
    // use-location도 이 상태에서는 권한을 묻지 않는다.
    expect(getPermissionNoticeState()).toBe('loading');
    await ensurePermissionNoticeLoaded();
    expect(getPermissionNoticeState()).toBe('pending');
    await expect(isPermissionNoticeAcknowledged()).resolves.toBe(false);
  });

  it('현재 버전을 확인한 기록이 있으면 다시 고지하지 않는다', async () => {
    mockedStorage.getItem.mockResolvedValue(PERMISSION_NOTICE_VERSION);
    const { isPermissionNoticeAcknowledged } = freshModule();
    await expect(isPermissionNoticeAcknowledged()).resolves.toBe(true);
  });

  it(
    '고지 내용이 개정되면(저장된 값이 옛 버전) 다시 고지한다 — 권한 항목이 늘어난 채 ' +
      '기존 이용자에게만 고지가 생략되는 것이 법이 막으려는 상황이다',
    async () => {
      mockedStorage.getItem.mockResolvedValue('1970-01-01');
      const { isPermissionNoticeAcknowledged } = freshModule();
      await expect(isPermissionNoticeAcknowledged()).resolves.toBe(false);
    },
  );

  it('확인하면 현재 버전을 저장하고 구독자에게 알린다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    const { acknowledgePermissionNotice, ensurePermissionNoticeLoaded, subscribeToPermissionNotice, getPermissionNoticeState } =
      freshModule();
    await ensurePermissionNoticeLoaded();

    const onChange = jest.fn();
    const unsubscribe = subscribeToPermissionNotice(onChange);
    await acknowledgePermissionNotice();

    expect(mockedStorage.setItem).toHaveBeenCalledWith('permission-notice', PERMISSION_NOTICE_VERSION);
    expect(getPermissionNoticeState()).toBe('acknowledged');
    // use-location이 이 알림을 받아 그제서야 GPS를 시작한다.
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it(
    '저장소 읽기가 늦게 끝나도 그 사이의 확인을 덮지 않는다 — 덮으면 고지 화면이 다시 떠 ' +
      '이용자가 같은 고지를 두 번 확인하게 된다',
    async () => {
      let resolveRead!: (value: string | null) => void;
      mockedStorage.getItem.mockReturnValue(
        new Promise<string | null>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const { acknowledgePermissionNotice, ensurePermissionNoticeLoaded, getPermissionNoticeState } =
        freshModule();

      const loading = ensurePermissionNoticeLoaded();
      await acknowledgePermissionNotice();
      resolveRead(null);
      await loading;

      expect(getPermissionNoticeState()).toBe('acknowledged');
    },
  );

  it('저장이 실패해도 진행을 막지 않는다 — 고지는 이미 표시했고, 다음 실행에 다시 뜰 뿐이다', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    mockedStorage.setItem.mockRejectedValue(new Error('quota'));
    const { acknowledgePermissionNotice, getPermissionNoticeState } = freshModule();

    await expect(acknowledgePermissionNotice()).resolves.toBeUndefined();
    expect(getPermissionNoticeState()).toBe('acknowledged');
  });
});
