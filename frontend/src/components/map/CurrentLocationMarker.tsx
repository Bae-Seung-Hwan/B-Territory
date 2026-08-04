import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { BrandColors, withAlpha } from '@/constants/theme';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface CurrentLocationMarkerProps {
  coordinate: { latitude: number; longitude: number };
}

// 카카오맵 CustomOverlay + CSS pulse 애니메이션(my-location-dot)을 reanimated로 재구현.
// 마커가 이 하나뿐이라 tracksViewChanges={true}를 상시 켜도 500개 POI 마커와 달리 성능 부담이 없다.
export const CurrentLocationMarker = memo(function CurrentLocationMarker({
  coordinate,
}: CurrentLocationMarkerProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1);
  }, [progress]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.4 + progress.value * 0.6 }],
    opacity: 0.8 * (1 - progress.value),
  }));

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges>
      <Animated.View style={styles.wrapper}>
        <Animated.View style={[styles.pulse, pulseStyle]} />
        <Animated.View style={styles.dot} />
      </Animated.View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  wrapper: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: BrandColors.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  pulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: withAlpha(BrandColors.accent, 0.25),
  },
});
