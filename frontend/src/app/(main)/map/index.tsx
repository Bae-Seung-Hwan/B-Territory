import { useRef } from 'react';
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
import { fetchBusanSpots } from '@/api/spots';

export default function MapScreen() {
  // TODO: 좌표를 소켓 location:update로 보내는 배선이 없어 조우 탐지(encounter:detected)가
  // 트리거될 수 없음. docs/integrations.md 참고
  const {
    data: spots,
    isError: isSpotsError,
    refetch: refetchSpots,
  } = useQuery({ queryKey: ['spots', 'busan'], queryFn: fetchBusanSpots });
  const { coords } = useLocation();
  const isOutsideBusan = coords != null && !isWithinBusanBounds(coords.latitude, coords.longitude);
  const mapRef = useRef<BusanMapViewHandle>(null);

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
