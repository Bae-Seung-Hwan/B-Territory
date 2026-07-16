import { View, StyleSheet } from 'react-native';
import { KakaoMapView } from '@/components/map/KakaoMapView';
import { MapHUD } from '@/components/map/MapHUD';
import { BrandColors } from '@/constants/theme';

export default function MapScreen() {
  // TODO: useLocation()이 아직 이 화면에 연결되지 않음 — 좌표를 소켓 location:update로
  // 보내는 배선이 없어 조우 탐지(encounter:detected)가 트리거될 수 없음. docs/integrations.md 참고
  return (
    <View style={styles.container}>
      <KakaoMapView style={StyleSheet.absoluteFill} />
      <MapHUD />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
});
