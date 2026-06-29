import { View, StyleSheet } from 'react-native';
import { KakaoMapView } from '@/components/map/KakaoMapView';
import { MapHUD } from '@/components/map/MapHUD';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <KakaoMapView style={StyleSheet.absoluteFill} />
      <MapHUD />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
});
