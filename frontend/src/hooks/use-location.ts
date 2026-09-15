import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import {
  isPermissionNoticeAcknowledged,
  subscribeToPermissionNotice,
} from '@/lib/permission-notice';

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
 *
 * develop(PR #50)은 한때 이 공유 구조를 "소비자가 map/index.tsx뿐"이라는 근거로
 * 훅 인스턴스별 독립 구독으로 되돌렸었다 — 그 근거가 이 브랜치에서 다시 무효화된다.
 * `LocationBroadcaster`가 조우 판정을 위해 앱 루트에 상주하며 이 훅을 구독하므로
 * map 화면과 합쳐 소비자가 다시 둘 이상이다. 되돌리면 두 곳이 각자 고정밀 watcher를
 * 켜 배터리를 이중으로 쓰고, 이 파일이 고친 권한 재시도(리뷰 지적 13번)·좌표 초기화
 * (리뷰 지적 12번)도 함께 사라진다 — 그래서 공유 스토어 쪽을 유지한다.
 */
let state: LocationState = { coords: null, error: null, loading: true };
const listeners = new Set<() => void>();
let subscription: Location.LocationSubscription | null = null;
let starting = false;
let locationGeneration = 0;
// 한 번 거부되면 소비자가 새로 마운트될 때마다(화면 이동 등) requestForegroundPermissionsAsync를
// 다시 호출하지 않는다(PR #54 리뷰 지적 13번) — subscription/starting 가드만으로는 거부 경로에서
// 둘 다 원상태로 돌아가 다음 subscribe()가 처음부터 다시 묻는다. 이 플래그는 포그라운드 복귀로
// 풀지 않는다 — 대신 대화상자를 띄우지 않는 getForegroundPermissionsAsync로 현재 상태만 조용히
// 다시 확인한다(resolvePermissionStatus 참고). 예전엔 'active' 전환마다 false로 되돌렸는데,
// 안드로이드에서는 OS 권한 팝업 자체가 'background'→'active'를 만들기 때문에 이용자가 거부를
// 누른 직후 팝업이 한 번 더 뜨는 경로가 됐다 — 원스토어 반려 사유 1번을 그대로 되살린다.
let permissionDenied = false;
// 안드로이드에서 OS 권한 대화상자는 별도 액티비티라, 띄우는 동안 우리 액티비티가 onPause 되고
// AppState가 'background'를 쏜다 — 이용자가 앱을 떠난 것이 아니므로 그 사이에는 구독을 접지도,
// generation을 밀지도 않는다. 밀면 await가 풀린 뒤의 권한 결과가 전부 stale로 버려진다.
let requestingPermission = false;
// 모듈이 처음 로드될 때가 아니라 첫 구독자가 생길 때 딱 한 번만 등록한다(subscribe() 참고) —
// GPS watcher를 지연 시작하는 이 파일의 기존 철학과 같은 이유일 뿐 아니라, 모듈 로드 시점에
// 곧바로 네이티브 이벤트 이미터를 건드리면 테스트에서 이 모듈을 import하는 순간 앱스테이트
// 목이 아직 준비되기 전에 실행될 위험도 없앤다.
let appStateSubscription: { remove: () => void } | null = null;
// 접근권한 사전 고지를 확인하기 전에는 OS 권한 대화상자를 띄우지 않는다(정보통신망법
// 제22조의2 / 원스토어 반려 사유 1번). 확인되는 순간을 알아야 그때 GPS를 시작할 수 있는데,
// 고지 화면은 React 트리에 있고 이 스토어는 모듈 스코프라 렌더로는 이어지지 않는다 —
// AppState와 같은 이유·같은 방식으로 첫 구독자가 생길 때 한 번만 등록한다.
let noticeSubscription: (() => void) | null = null;
function ensurePermissionNoticeListener(): void {
  if (noticeSubscription) return;
  noticeSubscription = subscribeToPermissionNotice(() => {
    // AppState 복구 경로와 같은 판단이다 — 지금 구독자가 없다면 다음 subscribe()가 어차피
    // 시작하므로, 여기서 미리 권한을 물어 고지 직후 빈 화면에 팝업을 띄우지 않는다.
    if (listeners.size > 0) void start();
  });
}

function ensureAppStateListener(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'background') {
      if (requestingPermission) return;
      locationGeneration += 1;
      subscription?.remove();
      subscription = null;
      // error는 남겨둔다 — 권한을 거부한 이용자가 포그라운드로 돌아올 때마다 이미 떠 있던
      // "위치 권한이 필요합니다"가 로딩으로 덮여 깜빡이지 않도록.
      setState({ coords: null, error: state.error, loading: true });
      return;
    }
    // 'inactive'에는 아무것도 하지 않는다 — iOS가 제어센터·알림 배너·앱 스위처·전화 수신·
    // 시스템 대화상자처럼 잠깐 가려질 때마다 쏘는 상태다. 여기서 watcher를 해제하면 그때마다
    // 현재위치 마커가 사라지고(coords: null) 복귀할 때 권한 확인부터 다시 돈다.
    if (next !== 'active') return;
    if (listeners.size > 0) void start();
  });
}

function setState(next: LocationState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

/**
 * 아직 묻지 않았다면 묻고, 이미 거부된 뒤라면 대화상자 없이 현재 상태만 읽는다.
 * 후자가 이용자가 OS 설정에서 권한을 바꾸고 돌아오는 복구 경로를 살려두면서도 포그라운드
 * 복귀마다 시스템 팝업을 다시 띄우지 않는 유일한 방법이다(원스토어 반려 사유 1번).
 */
async function resolvePermissionStatus(): Promise<Location.PermissionStatus> {
  if (permissionDenied) {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status;
  }
  requestingPermission = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status;
  } finally {
    requestingPermission = false;
  }
}

async function start(): Promise<void> {
  if (starting || subscription || listeners.size === 0 || AppState.currentState !== 'active') return;
  starting = true;
  const generation = locationGeneration;
  const isCurrent = () =>
    generation === locationGeneration && listeners.size > 0 && AppState.currentState === 'active';
  try {
    // 고지 확인 전에는 로딩 상태로 멈춰 선다. 여기서 에러로 떨어뜨리면 지도 화면이
    // "위치 권한이 필요합니다"를 고지문 뒤에 미리 띄우게 된다 — 아직 묻지도 않은 권한이다.
    if (!(await isPermissionNoticeAcknowledged())) {
      setState({ coords: null, error: null, loading: true });
      return;
    }
    if (!isCurrent()) return;
    const status = await resolvePermissionStatus();
    // 권한 결과는 generation이 아니라 앱 전역의 사실이므로 staleness 체크보다 **먼저** 기록한다.
    // 순서를 뒤집으면, 권한 팝업 때문에 generation이 밀린 경우 거부 사실이 유실되고 아래
    // finally의 재시작이 거부 직후 팝업을 한 번 더 띄운다(원스토어 반려 사유 1번).
    permissionDenied = status !== 'granted';
    if (permissionDenied) {
      // 마지막 구독자가 나갔다 들어오는 사이 state가 초기화됐을 수 있다(리뷰 지적 12번) —
      // 이미 아는 결과를 다시 반영해줘야 새 구독자가 "영원히 로딩 중"에 갇히지 않는다.
      if (isCurrent()) setState({ coords: null, error: '위치 권한이 필요합니다', loading: false });
      return;
    }
    if (!isCurrent()) return;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        if (!isCurrent()) return;
        setState({
          coords: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          error: null,
          loading: false,
        });
      },
    );
    // 권한/구독을 기다리는 사이 마지막 구독자가 떠났으면 즉시 정리한다.
    if (!isCurrent()) {
      sub.remove();
      return;
    }
    subscription = sub;
  } catch (e) {
    if (!isCurrent()) return;
    const message = e instanceof Error ? e.message : '위치 정보를 가져올 수 없습니다';
    setState({ coords: null, error: message, loading: false });
  } finally {
    starting = false;
    // 비동기 시작 중 중지·복귀한 경우 이전 요청을 버리고 새 구독을 시작한다.
    if (generation !== locationGeneration) void start();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  ensurePermissionNoticeListener();
  ensureAppStateListener();
  listeners.add(onStoreChange);
  void start();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      locationGeneration += 1;
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
