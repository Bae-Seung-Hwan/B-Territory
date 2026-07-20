import { useState, useEffect } from 'react';
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

export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({ coords: null, error: null, loading: true });

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

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
        // watchPositionAsync 대기 중 언마운트되면 subscription 변수가 아직 비어 있어
        // 아래 cleanup의 subscription?.remove()가 이 구독을 잡지 못한다 — 즉시 정리한다.
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
