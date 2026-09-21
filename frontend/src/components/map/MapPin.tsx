import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps';
import { BrandColors } from '@/constants/theme';
import { useTranslation } from '@/i18n';

/** MapPin이 지원하는 관광지 말풍선 데이터. 임의의 Marker 자식 뷰는 허용하지 않는다. */
export interface MapPinCallout {
  categoryKey: string;
  categoryColor: string;
  title: string;
  address?: string | null;
  claimText: string;
  onPress: () => void;
}

export interface MapPinProps {
  coordinate: MapMarkerProps['coordinate'];
  color: string;
  onPress?: MapMarkerProps['onPress'];
  /** 관광지 핀은 기본값 10. 더 높은 값일수록 다른 핀 위에 표시된다. */
  zIndex?: number;
  callout?: MapPinCallout | null;
}

// 핀 본체는 SDK가 직접 렌더링한다. SVG나 애니메이션 자식 뷰의 스냅샷에 의존하지 않는다.
// 말풍선도 데이터로만 받아 여기서 생성해, 소비자가 Marker 안에 임의의 렌더링 뷰를 넣지 못하게 한다.
function SpotCallout({ categoryKey, categoryColor, title, address, claimText, onPress }: MapPinCallout) {
  const { t } = useTranslation();

  return (
    <Callout onPress={onPress}>
      <View style={styles.callout}>
        <Text style={[styles.calloutCategory, { color: categoryColor }]}>
          {t(`map.categories.${categoryKey}`)}
        </Text>
        <Text style={styles.calloutTitle}>{title}</Text>
        {address && (
          <Text style={styles.calloutAddr}>
            {t('map.callout.address')}: {address}
          </Text>
        )}
        <Text style={styles.calloutClaim}>
          {t('map.callout.claimStatus')}: {claimText}
        </Text>
      </View>
    </Callout>
  );
}

// 말풍선 제어에 필요한 네이티브 Marker ref는 소비자에게 그대로 전달한다.
export const MapPin = forwardRef<MapMarker, MapPinProps>(function MapPin(
  { coordinate, color, onPress, zIndex = 10, callout },
  ref,
) {
  return (
    <Marker ref={ref} coordinate={coordinate} pinColor={color} zIndex={zIndex} onPress={onPress}>
      {callout && <SpotCallout {...callout} />}
    </Marker>
  );
});

const styles = StyleSheet.create({
  // 말풍선 폭을 고정하지 않으면 Android에서 내용이 한 줄로 눌려 잘린다.
  callout: { width: 200, paddingVertical: 2 },
  calloutCategory: { fontSize: 11, fontWeight: '700' },
  calloutTitle: { fontSize: 14, fontWeight: '600', color: '#111' },
  calloutAddr: { marginTop: 2, fontSize: 12, color: '#666' },
  calloutClaim: { marginTop: 4, fontSize: 12, fontWeight: '600', color: BrandColors.accent },
});
