import { forwardRef, type ReactNode } from 'react';
import { Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps';

export interface MapPinProps {
  coordinate: MapMarkerProps['coordinate'];
  color: string;
  onPress?: MapMarkerProps['onPress'];
  callout?: ReactNode;
}

// 핀 본체는 SDK가 직접 렌더링한다. SVG나 애니메이션 자식 뷰의 스냅샷에 의존하지 않는다.
// 말풍선 제어에 필요한 네이티브 Marker ref는 소비자에게 그대로 전달한다.
export const MapPin = forwardRef<MapMarker, MapPinProps>(function MapPin(
  { coordinate, color, onPress, callout },
  ref,
) {
  return (
    <Marker ref={ref} coordinate={coordinate} pinColor={color} onPress={onPress}>
      {callout}
    </Marker>
  );
});
