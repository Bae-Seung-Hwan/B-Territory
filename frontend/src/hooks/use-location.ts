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

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState({ coords: null, error: '위치 권한이 필요합니다', loading: false });
        return;
      }
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (loc) => {
          setState({
            coords: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
            error: null,
            loading: false,
          });
        },
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  return state;
}
