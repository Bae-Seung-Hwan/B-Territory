import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

interface Coords {
  latitude: number;
  longitude: number;
}

interface LocationState {
  coords: Coords | null;
  error: string | null;
  loading: boolean;
}

/**
 * GPS 구독은 모듈 스코프에 하나만 두고 모든 useLocation() 호출자가 공유한다.
 * 훅마다 watchPositionAsync를 따로 걸면 지도 탭·채팅 탭·위치 송신이 각자 고정밀
 * 구독을 만들어 배터리를 그만큼 더 쓴다(화면은 한 번 열면 언마운트되지 않으므로
 * 동시에 살아있다). 마지막 구독자가 사라질 때만 실제 watcher를 해제한다.
 */
let state: LocationState = { coords: null, error: null, loading: true };
const listeners = new Set<() => void>();
let subscription: Location.LocationSubscription | null = null;
let starting = false;
// 한 번 거부되면 소비자가 새로 마운트될 때마다(화면 이동 등) requestForegroundPermissionsAsync를
// 다시 호출하지 않는다(PR #54 리뷰 지적 13번) — subscription/starting 가드만으로는 거부 경로에서
// 둘 다 원상태로 돌아가 다음 subscribe()가 처음부터 다시 묻는다. 앱이 포그라운드로 돌아올 때는
// 풀어준다 — OS 설정 화면에서 권한을 바꾸고 돌아오는 유일한 신호이기 때문이다.
let permissionDenied = false;
// 모듈이 처음 로드될 때가 아니라 첫 구독자가 생길 때 딱 한 번만 등록한다(subscribe() 참고) —
// GPS watcher를 지연 시작하는 이 파일의 기존 철학과 같은 이유일 뿐 아니라, 모듈 로드 시점에
// 곧바로 네이티브 이벤트 이미터를 건드리면 테스트에서 이 모듈을 import하는 순간 앱스테이트
// 목이 아직 준비되기 전에 실행될 위험도 없앤다.
let appStateSubscription: { remove: () => void } | null = null;
function ensureAppStateListener(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') permissionDenied = false;
  });
}

function setState(next: LocationState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

async function start(): Promise<void> {
  if (permissionDenied) {
    // API를 다시 부르진 않지만(리뷰 지적 13번), 마지막 구독자가 나갔다 들어오는 사이
    // state가 초기화됐을 수 있다(리뷰 지적 12번) — 이미 아는 결과를 다시 반영해줘야
    // 새 구독자가 "영원히 로딩 중"에 갇히지 않는다.
    setState({ coords: null, error: '위치 권한이 필요합니다', loading: false });
    return;
  }
  if (starting || subscription) return;
  starting = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      permissionDenied = true;
      setState({ coords: null, error: '위치 권한이 필요합니다', loading: false });
      return;
    }
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        setState({
          coords: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          error: null,
          loading: false,
        });
      },
    );
    // 권한/구독을 기다리는 사이 마지막 구독자가 떠났으면 즉시 정리한다.
    if (listeners.size === 0) {
      sub.remove();
      return;
    }
    subscription = sub;
  } catch (e) {
    const message = e instanceof Error ? e.message : '위치 정보를 가져올 수 없습니다';
    setState({ coords: null, error: message, loading: false });
  } finally {
    starting = false;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  ensureAppStateListener();
  listeners.add(onStoreChange);
  void start();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
      // state는 그대로 두면 안 된다 — subscription만 비우면, 로그아웃 후 재로그인처럼
      // 마지막 구독자가 사라졌다 새 구독자가 곧바로 붙는 경우 getSnapshot()이 새 watcher의
      // 첫 픽스가 오기 전까지 이전 사용자의 낡은 좌표를 그대로 돌려준다 — 그 좌표로
      // location:update가 나가 조우 판정이 이미 떠난 위치를 기준으로 돌아간다(PR #54
      // 리뷰 지적 12번). 리스너가 이미 없는 시점이라 setState()의 notify는 의미 없어
      // 직접 대입한다.
      state = { coords: null, error: null, loading: true };
    }
  };
}

function getSnapshot(): LocationState {
  return state;
}

export function useLocation(): LocationState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
