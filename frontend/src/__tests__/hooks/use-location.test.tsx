import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocation } from '@/hooks/use-location';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(),
  // 거부 이후의 재확인은 대화상자를 띄우지 않는 이쪽으로만 한다 — 두 목을 따로 두는 것이
  // "팝업이 다시 떴는지"를 테스트가 구분할 수 있는 유일한 방법이다.
  getForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

// react-native/index.js가 AppState를 `require('./Libraries/AppState/AppState').default`로
// 지연 로드하므로(use-chat-socket.test.tsx와 동일한 이유), 'react-native' 전체가 아니라
// 이 서브모듈 하나만 목킹한다.
const mockAppState: { currentState: string; listener: ((state: string) => void) | null } = {
  currentState: 'active',
  listener: null,
};
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockAppState.currentState;
    },
    addEventListener: jest.fn((_type: string, cb: (state: string) => void) => {
      mockAppState.listener = cb;
      return { remove: jest.fn() };
    }),
  },
}));

// 접근권한 사전 고지(정보통신망법 제22조의2)는 이 훅의 관심사가 아니라 전제다 — 확인 여부를
// 테스트가 직접 쥐고, "확인 전에는 OS 권한을 묻지 않는다"만 검증한다.
const mockNotice = { acknowledged: true, listeners: new Set<() => void>() };
jest.mock('@/lib/permission-notice', () => ({
  isPermissionNoticeAcknowledged: jest.fn(async () => mockNotice.acknowledged),
  subscribeToPermissionNotice: jest.fn((cb: () => void) => {
    mockNotice.listeners.add(cb);
    return () => mockNotice.listeners.delete(cb);
  }),
}));

const mockedRequestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockedGetPermission = Location.getForegroundPermissionsAsync as jest.Mock;
const mockedWatchPosition = Location.watchPositionAsync as jest.Mock;

// use-location.ts는 모듈 스코프 상태(permissionDenied·subscription·state)를 공유한다 —
// jest.resetModules()로 격리하면 React 자체도 새로 로드돼 "두 개의 React 사본" 문제가
// 난다. 대신 실제 앱과 같은 방식으로, 마운트~언마운트를 이어서 겪는 시나리오 하나로
// 검증한다(화면을 오가도 이 모듈은 리셋되지 않는다는 사실 자체가 리뷰 지적 12·13번의
// 배경이기도 하다). AppState 리스너도 ensureAppStateListener()가 딱 한 번만 등록하므로
// (module-level 싱글턴), mockAppState.listener를 채우는 것도 사실상 이 첫 테스트뿐이다 —
// 그래서 "이미 마운트된 구독자가 리스너로 복구되는지"까지 같은 시나리오 안에서 검증한다.
describe('useLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.currentState = 'active';
    // mockAppState.listener는 비우지 않는다 — ensureAppStateListener()가 **맨 처음 구독자
    // 때 딱 한 번만** 등록하므로(모듈 싱글턴), 여기서 null로 되돌리면 그 뒤의 테스트는
    // 리스너를 부를 방법을 영영 잃는다. 첫 테스트가 채워둔 핸들을 그대로 물려받는다.
  });

  it(
    '접근권한 사전 고지를 확인하기 전에는 OS 권한 대화상자를 띄우지 않고, 확인되는 순간 ' +
      '그제서야 시작한다 — 이미 로그인된 채로 앱을 업데이트한 이용자는 고지 화면과 ' +
      'LocationBroadcaster가 같은 프레임에 함께 마운트되므로, 화면만으로 막으면 고지문 위로 ' +
      'OS 팝업이 겹쳐 뜬다(원스토어 반려 사유 1번)',
    async () => {
      mockNotice.acknowledged = false;
      const { result, unmount } = await renderHook(() => useLocation());

      // 아직 아무것도 묻지 않았다. 에러가 아니라 로딩이어야 한다 — 에러로 떨어뜨리면
      // 지도 화면이 "위치 권한이 필요합니다"를 묻지도 않은 채 먼저 띄운다.
      await waitFor(() => expect(mockNotice.listeners.size).toBe(1));
      expect(mockedRequestPermission).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();

      mockedRequestPermission.mockResolvedValue({ status: 'granted' });
      mockedWatchPosition.mockResolvedValue({ remove: jest.fn() });

      await act(async () => {
        mockNotice.acknowledged = true;
        mockNotice.listeners.forEach((notify) => notify());
      });

      await waitFor(() => expect(mockedRequestPermission).toHaveBeenCalledTimes(1));
      await unmount();
      mockNotice.acknowledged = true;
    },
  );

  it(
    '권한이 거부되면: (1) 다시 마운트해도 API를 또 부르지 않되 알려진 결과는 다시 반영하고 ' +
      '(리뷰 지적 13번), (2) 이미 마운트돼 있던 구독자도 앱이 포그라운드로 돌아오면 그제서야 ' +
      '다시 확인한다 (PR #54 2차 리뷰 지적 3번 — 예전엔 AppState 리스너가 permissionDenied ' +
      '플래그만 풀고 start()를 다시 부르지 않았는데, start()의 유일한 호출부인 subscribe()는 ' +
      '구독자 수가 0→1로 늘어날 때만 불리므로, LocationBroadcaster처럼 이미 붙어있는 구독자를 ' +
      '위해서는 아무도 다시 불러주지 않아 권한을 나중에 허용해도 세션 내내 복구되지 않았다)',
    async () => {
      mockedRequestPermission.mockResolvedValue({ status: 'denied' });
      mockedGetPermission.mockResolvedValue({ status: 'denied' });

      const first = await renderHook(() => useLocation());
      await waitFor(() => expect(first.result.current.error).toBe('위치 권한이 필요합니다'));
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
      await first.unmount();

      // 마지막 구독자가 나갔다 들어와도(리뷰 지적 12번 픽스로 상태는 초기화됐을 것이다)
      // 이미 거부된 것으로 알고 있으므로 API를 다시 부르지 않되, 결과는 그대로 반영한다 —
      // 그러지 않으면 이 두 번째 구독자가 "영원히 로딩 중"에 갇힌다. 이 구독자는 아래에서
      // 언마운트하지 않고 그대로 둔다 — LocationBroadcaster처럼 세션 내내 상주하는 상황을
      // 재현하기 위함이다.
      const second = await renderHook(() => useLocation());
      await waitFor(() => expect(second.result.current.error).toBe('위치 권한이 필요합니다'));
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);

      // 설정 화면에서 권한을 허용하고 앱으로 돌아왔다고 가정한다(백그라운드→포그라운드가
      // 유일한 복구 신호다). 복구는 대화상자를 띄우지 않는 getForegroundPermissionsAsync로만
      // 확인해야 한다 — request 쪽을 쓰면 복귀할 때마다 OS 팝업이 다시 뜬다.
      mockedGetPermission.mockResolvedValue({ status: 'granted' });
      let onLocation:
        | ((loc: { coords: { latitude: number; longitude: number } }) => void)
        | null = null;
      mockedWatchPosition.mockImplementation((_opts, cb) => {
        onLocation = cb;
        return Promise.resolve({ remove: jest.fn() });
      });

      await act(async () => {
        mockAppState.currentState = 'background';
        mockAppState.listener?.('background');
        mockAppState.currentState = 'active';
        mockAppState.listener?.('active');
      });

      // second는 언마운트된 적이 없다 — 그런데도 권한을 다시 확인해야 한다. 새 구독자의
      // subscribe()에 기대지 않고, 리스너 자신이 재시도해야만 가능하다.
      await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(1));
      // 그 재확인이 팝업이어서는 안 된다 — request는 맨 처음 한 번에서 늘어나지 않는다.
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
      await act(async () => onLocation?.({ coords: { latitude: 10, longitude: 20 } }));
      await waitFor(() =>
        expect(second.result.current.coords).toEqual({ latitude: 10, longitude: 20 }),
      );
      expect(second.result.current.error).toBeNull();
      await second.unmount();
    },
  );

  it('백그라운드에서는 구독과 좌표를 지우고 복귀 후 새 좌표를 사용한다', async () => {
    mockedRequestPermission.mockResolvedValue({ status: 'granted' });
    const remove = jest.fn();
    const callbacks: ((loc: { coords: { latitude: number; longitude: number } }) => void)[] = [];
    mockedWatchPosition.mockImplementation((_opts, cb) => {
      callbacks.push(cb);
      return Promise.resolve({ remove });
    });
    const hook = await renderHook(() => useLocation());
    await waitFor(() => expect(callbacks).toHaveLength(1));
    await act(async () => callbacks[0]({ coords: { latitude: 1, longitude: 2 } }));
    await act(async () => {
      mockAppState.currentState = 'background';
      mockAppState.listener?.('background');
      callbacks[0]({ coords: { latitude: 3, longitude: 4 } });
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(hook.result.current.coords).toBeNull();
    await act(async () => {
      mockAppState.currentState = 'active';
      mockAppState.listener?.('active');
    });
    await waitFor(() => expect(callbacks).toHaveLength(2));
    expect(hook.result.current.coords).toBeNull();
    await act(async () => callbacks[1]({ coords: { latitude: 5, longitude: 6 } }));
    expect(hook.result.current.coords).toEqual({ latitude: 5, longitude: 6 });
    await hook.unmount();
  });

  it('watcher 생성 대기 중 중지·복귀하면 오래된 구독을 버리고 다시 시작한다', async () => {
    mockedRequestPermission.mockResolvedValue({ status: 'granted' });
    let resolveWatch!: (value: { remove: jest.Mock }) => void;
    const staleRemove = jest.fn();
    mockedWatchPosition.mockImplementationOnce(() => new Promise((resolve) => { resolveWatch = resolve; }));
    mockedWatchPosition.mockResolvedValue({ remove: jest.fn() });
    const hook = await renderHook(() => useLocation());
    await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockAppState.currentState = 'background';
      mockAppState.listener?.('background');
      mockAppState.currentState = 'active';
      mockAppState.listener?.('active');
      resolveWatch({ remove: staleRemove });
    });
    await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(2));
    expect(staleRemove).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it(
    "iOS의 'inactive'는 백그라운드로 취급하지 않는다 — 제어센터·알림 배너·앱 스위처·전화 " +
      '수신·시스템 대화상자처럼 잠깐 가려질 때마다 쏘는 상태라, 여기서 watcher를 해제하면 ' +
      '그때마다 현재위치 마커가 사라지고(coords: null) 복귀할 때 권한 확인부터 다시 돈다',
    async () => {
      mockedRequestPermission.mockResolvedValue({ status: 'granted' });
      const remove = jest.fn();
      let onLocation: ((loc: { coords: { latitude: number; longitude: number } }) => void) | null =
        null;
      mockedWatchPosition.mockImplementation((_opts, cb) => {
        onLocation = cb;
        return Promise.resolve({ remove });
      });

      const hook = await renderHook(() => useLocation());
      await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(1));
      await act(async () => onLocation?.({ coords: { latitude: 7, longitude: 8 } }));
      await waitFor(() => expect(hook.result.current.coords).toEqual({ latitude: 7, longitude: 8 }));

      await act(async () => {
        mockAppState.currentState = 'inactive';
        mockAppState.listener?.('inactive');
      });
      expect(remove).not.toHaveBeenCalled();
      expect(hook.result.current.coords).toEqual({ latitude: 7, longitude: 8 });

      await act(async () => {
        mockAppState.currentState = 'active';
        mockAppState.listener?.('active');
      });
      // 구독이 살아있으니 다시 시작할 것도, 다시 물어볼 것도 없다.
      expect(mockedWatchPosition).toHaveBeenCalledTimes(1);
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
      await hook.unmount();
    },
  );

  it(
    '권한 팝업이 만드는 백그라운드 전환 때문에 거부가 유실되지 않는다 — 안드로이드에서 OS ' +
      '권한 대화상자는 별도 액티비티라 띄우는 순간 AppState가 background를 쏜다. 거부 결과를 ' +
      'staleness 체크 뒤에 기록하면 그 결과가 stale로 버려지고, finally의 재시작이 이용자가 ' +
      '거부를 누른 직후 팝업을 한 번 더 띄운다(원스토어 반려 사유 1번)',
    async () => {
      let resolvePermission!: (value: { status: string }) => void;
      mockedRequestPermission.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePermission = resolve;
          }),
      );
      mockedGetPermission.mockResolvedValue({ status: 'denied' });

      const hook = await renderHook(() => useLocation());
      await waitFor(() => expect(mockedRequestPermission).toHaveBeenCalledTimes(1));

      // 팝업이 떠 있는 동안의 background다 — 이용자가 앱을 떠난 게 아니므로 구독을 접거나
      // generation을 밀어선 안 된다. 그 뒤 '거부'가 도착하고, 팝업이 닫히며 active로 돌아온다.
      await act(async () => {
        mockAppState.currentState = 'background';
        mockAppState.listener?.('background');
        resolvePermission({ status: 'denied' });
      });
      await act(async () => {
        mockAppState.currentState = 'active';
        mockAppState.listener?.('active');
      });

      await waitFor(() => expect(hook.result.current.error).toBe('위치 권한이 필요합니다'));
      expect(hook.result.current.loading).toBe(false);
      // 핵심: 거부를 기억하므로 팝업이 다시 뜨지 않는다. 복귀 확인은 대화상자 없는 쪽으로만.
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
      expect(mockedGetPermission).toHaveBeenCalled();

      // 백그라운드로 내려가도 이미 떠 있는 에러를 로딩으로 덮지 않는다(복귀마다 깜빡임 방지).
      await act(async () => {
        mockAppState.currentState = 'background';
        mockAppState.listener?.('background');
      });
      expect(hook.result.current.error).toBe('위치 권한이 필요합니다');

      // 설정에서 허용하고 돌아오면 팝업 없이 복구된다. 이 경로로 모듈 스코프의
      // permissionDenied까지 되돌려 놓는다 — 아래 테스트가 이어서 쓰는 상태다(파일 맨 위 주석).
      mockedGetPermission.mockResolvedValue({ status: 'granted' });
      mockedWatchPosition.mockResolvedValue({ remove: jest.fn() });
      await act(async () => {
        mockAppState.currentState = 'active';
        mockAppState.listener?.('active');
      });
      await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(1));
      expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
      await hook.unmount();
    },
  );

  it.each(['granted', 'denied'])('권한 처리 중 복귀한 경우 %s 결과를 반영한다', async (status) => {
    let resolvePermission!: (value: { status: string }) => void;
    mockedRequestPermission.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePermission = resolve;
    }));
    mockedRequestPermission.mockResolvedValue({ status });
    mockedGetPermission.mockResolvedValue({ status });
    mockedWatchPosition.mockResolvedValue({ remove: jest.fn() });
    const hook = await renderHook(() => useLocation());
    await waitFor(() => expect(mockedRequestPermission).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockAppState.currentState = 'background';
      mockAppState.listener?.('background');
      resolvePermission({ status });
      await Promise.resolve();
      await Promise.resolve();
      mockAppState.currentState = 'active';
      mockAppState.listener?.('active');
    });
    if (status === 'granted') {
      await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalled());
    } else {
      await waitFor(() => expect(hook.result.current.error).toBe('위치 권한이 필요합니다'));
    }
    await hook.unmount();
  });

  it(
    '마지막 구독자가 사라지면 좌표 상태도 초기화한다 — 그러지 않으면 다음 구독자(재로그인한 ' +
      '다른 사용자 등)가 새 위치가 잡히기 전까지 이전 좌표를 그대로 본다(PR #54 리뷰 지적 12번)',
    async () => {
      mockedRequestPermission.mockResolvedValue({ status: 'granted' });
      let onLocation: ((loc: { coords: { latitude: number; longitude: number } }) => void) | null =
        null;
      mockedWatchPosition.mockImplementation((_opts, cb) => {
        onLocation = cb;
        return Promise.resolve({ remove: jest.fn() });
      });

      mockedGetPermission.mockResolvedValue({ status: 'granted' });
      const first = await renderHook(() => useLocation());
      await waitFor(() => expect(mockedWatchPosition).toHaveBeenCalledTimes(1));
      await act(async () => onLocation?.({ coords: { latitude: 1, longitude: 2 } }));
      await waitFor(() => expect(first.result.current.coords).toEqual({ latitude: 1, longitude: 2 }));
      await first.unmount();

      // 두 번째 구독자는 아직 새 픽스를 받기 전이므로, 이전 좌표(1,2)가 아니라
      // 초기 상태(coords: null, loading: true)를 봐야 한다.
      mockedWatchPosition.mockImplementation(() => new Promise(() => {}));
      const second = await renderHook(() => useLocation());
      expect(second.result.current.coords).toBeNull();
      expect(second.result.current.loading).toBe(true);
      await second.unmount();
    },
  );
});
