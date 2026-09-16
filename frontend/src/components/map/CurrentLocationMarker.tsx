import { memo } from 'react';
import { Marker } from 'react-native-maps';
import { BrandColors } from '@/constants/theme';

interface CurrentLocationMarkerProps {
  coordinate: { latitude: number; longitude: number };
}

// `Marker` 자식으로 Reanimated 뷰를 넣고 tracksViewChanges를 계속 켜면 Android Google Maps가
// 애니메이션 중인 자식 뷰의 스냅샷을 잃어 Marker가 사라질 수 있다. 현재 위치는 이미
// 좌표 갱신으로 충분히 드러나므로, SDK가 직접 그리는 고정 pin을 사용한다.
export const CurrentLocationMarker = memo(function CurrentLocationMarker({
  coordinate,
}: CurrentLocationMarkerProps) {
  return <Marker coordinate={coordinate} pinColor={BrandColors.accent} />;
});
