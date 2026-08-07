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
import { queryKeys } from '@/lib/query-keys';
import { fetchBusanSpots } from '@/api/spots';
import { fetchCurrentCapital } from '@/api/districts';
import { useGameStore } from '@/store/useGameStore';

export default function MapScreen() {
  const {
    data: spots,
    isError: isSpotsError,
    refetch: refetchSpots,
  } = useQuery({ queryKey: queryKeys.spots.busan, queryFn: fetchBusanSpots });
  // 좌표를 서버로 보내는 일은 앱 루트의 LocationBroadcaster가 전담한다 — 지도 화면을
  // 벗어나 있어도 계속 보내야 서버가 나를 접속 중으로 보고 결투 알림을 실시간 전달한다.
  const { coords } = useLocation();

  // 이번 주 수도는 주 1회만 바뀌는 값이라 넉넉한 staleTime으로 재조회를 줄인다.
  // MapHUD/DistrictPolygons가 store를 직접 구독하므로 여기서는 받아서 채우기만 한다.
  const { data: capital } = useQuery({
    queryKey: queryKeys.districts.currentCapital,
    queryFn: fetchCurrentCapital,
    staleTime: 5 * 60 * 1000,
  });
  const setCapitalDistrict = useGameStore((s) => s.setCapitalDistrict);
  useEffect(() => {
    if (capital?.sigunguCode && capital.district) {
      setCapitalDistrict({
        sigunguCode: capital.sigunguCode,
        nameKo: capital.district.nameKo,
        nameEn: capital.district.nameEn,
        multiplier: capital.multiplier,
      });
    } else if (capital) {
      setCapitalDistrict(null);
    }
  }, [capital, setCapitalDistrict]);
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
