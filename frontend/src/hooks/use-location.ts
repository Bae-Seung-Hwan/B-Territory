import { useSyncExternalStore } from 'react';
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

function setState(next: LocationState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

async function start(): Promise<void> {
  if (starting || subscription) return;
  starting = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
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
  listeners.add(onStoreChange);
  void start();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
    }
  };
}

function getSnapshot(): LocationState {
  return state;
}

export function useLocation(): LocationState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
