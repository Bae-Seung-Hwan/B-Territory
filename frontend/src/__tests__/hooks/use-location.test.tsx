import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocation } from '@/hooks/use-location';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(),
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

const mockedRequestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
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
    mockAppState.listener = null;
  });

  it(
    '권한이 거부되면: (1) 다시 마운트해도 API를 또 부르지 않되 알려진 결과는 다시 반영하고 ' +
      '(리뷰 지적 13번), (2) 이미 마운트돼 있던 구독자도 앱이 포그라운드로 돌아오면 그제서야 ' +
      '다시 확인한다 (PR #54 2차 리뷰 지적 3번 — 예전엔 AppState 리스너가 permissionDenied ' +
      '플래그만 풀고 start()를 다시 부르지 않았는데, start()의 유일한 호출부인 subscribe()는 ' +
      '구독자 수가 0→1로 늘어날 때만 불리므로, LocationBroadcaster처럼 이미 붙어있는 구독자를 ' +
      '위해서는 아무도 다시 불러주지 않아 권한을 나중에 허용해도 세션 내내 복구되지 않았다)',
    async () => {
      mockedRequestPermission.mockResolvedValue({ status: 'denied' });

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
      // 유일한 복구 신호다).
      mockedRequestPermission.mockResolvedValue({ status: 'granted' });
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
      await waitFor(() => expect(mockedRequestPermission).toHaveBeenCalledTimes(2));
      await act(async () => onLocation?.({ coords: { latitude: 10, longitude: 20 } }));
      await waitFor(() =>
        expect(second.result.current.coords).toEqual({ latitude: 10, longitude: 20 }),
      );
      expect(second.result.current.error).toBeNull();
      await second.unmount();
    },
  );

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
