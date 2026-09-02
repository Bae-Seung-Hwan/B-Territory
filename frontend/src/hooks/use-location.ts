import { useEffect, useState } from 'react';
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
 * 모듈 스코프 공유 스토어(useSyncExternalStore)로 한때 재작성됐었지만, 그 근거였던
 * "지도 탭·채팅 탭·위치 송신이 각자 구독"은 위치 공유 기능 제거로 무효화됐다 — 현재
 * 유일한 호출자는 map/index.tsx뿐이다(PR #50 2차 리뷰 지적). 소비자가 하나뿐인 상태로
 * 전역 가변 상태를 유지할 이유가 없고, 그 상태는 로그아웃 후에도 남아 다음 사용자에게
 * 이전 좌표가 잠깐 보일 수 있었다. 훅 인스턴스마다 독립된 구독으로 되돌린다.
 */
export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    coords: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
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
        // 권한/구독을 기다리는 사이 이 화면이 이미 언마운트됐으면 즉시 정리한다.
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : '위치 정보를 가져올 수 없습니다';
        setState({ coords: null, error: message, loading: false });
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return state;
}
