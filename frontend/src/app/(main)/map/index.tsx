import { useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { KakaoMapView, KakaoMapViewHandle } from '@/components/map/KakaoMapView';
import { MapHUD } from '@/components/map/MapHUD';
import { OutOfBoundsBanner } from '@/components/map/OutOfBoundsBanner';
import { LocateMeButton } from '@/components/map/LocateMeButton';
import { BrandColors } from '@/constants/theme';
import { isWithinBusanBounds } from '@/constants/busan';
import { useLocation } from '@/hooks/use-location';
import { fetchBusanSpots } from '@/api/spots';

export default function MapScreen() {
  // TODO: 좌표를 소켓 location:update로 보내는 배선이 없어 조우 탐지(encounter:detected)가
  // 트리거될 수 없음. docs/integrations.md 참고
  const { data: spots } = useQuery({ queryKey: ['spots', 'busan'], queryFn: fetchBusanSpots });
  const { coords } = useLocation();
  const isOutsideBusan = coords != null && !isWithinBusanBounds(coords.latitude, coords.longitude);
  const mapRef = useRef<KakaoMapViewHandle>(null);

  return (
    <View style={styles.container}>
      <KakaoMapView ref={mapRef} style={StyleSheet.absoluteFill} spots={spots} coords={coords} />
      <MapHUD />
      <LocateMeButton onPress={() => coords && mapRef.current?.panTo(coords)} disabled={!coords} />
      {isOutsideBusan && <OutOfBoundsBanner />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
});
