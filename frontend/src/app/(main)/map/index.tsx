import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { BusanMapView, BusanMapViewHandle } from '@/components/map/BusanMapView';
import { MapHUD } from '@/components/map/MapHUD';
import { OutOfBoundsBanner } from '@/components/map/OutOfBoundsBanner';
import { SpotsErrorBanner } from '@/components/map/SpotsErrorBanner';
import { LocateMeButton } from '@/components/map/LocateMeButton';
import { BrandColors } from '@/constants/theme';
import { isWithinBusanBounds } from '@/constants/busan';
import { useLocation } from '@/hooks/use-location';
import { useSocket } from '@/providers/SocketProvider';
import { queryKeys } from '@/lib/query-keys';
import { fetchBusanSpots } from '@/api/spots';

export default function MapScreen() {
  const {
    data: spots,
    isError: isSpotsError,
    refetch: refetchSpots,
  } = useQuery({ queryKey: queryKeys.spots.busan, queryFn: fetchBusanSpots });
  const { coords } = useLocation();
  const socket = useSocket();
  const isOutsideBusan = coords != null && !isWithinBusanBounds(coords.latitude, coords.longitude);
  const mapRef = useRef<BusanMapViewHandle>(null);

  // useLocation()의 watchPositionAsync가 이미 distanceInterval:10m/timeInterval:5000ms로
  // 쓰로틀링하므로 여기서 추가 디바운스는 필요 없다.
  useEffect(() => {
    if (!coords) return;
    socket?.emit('location:update', { lat: coords.latitude, lng: coords.longitude });
  }, [coords, socket]);

  return (
    <View style={styles.container}>
      <BusanMapView ref={mapRef} style={StyleSheet.absoluteFill} spots={spots} coords={coords} />
      <MapHUD />
      <LocateMeButton onPress={() => coords && mapRef.current?.panTo(coords)} disabled={!coords} />
      {isOutsideBusan && <OutOfBoundsBanner />}
      {isSpotsError && <SpotsErrorBanner onPress={() => refetchSpots()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
});
