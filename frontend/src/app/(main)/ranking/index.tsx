import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RankingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>랭킹</Text>
      <Text style={styles.placeholder}>국가별 · 개인별 랭킹이 표시됩니다</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0F' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  placeholder: { color: '#555', fontSize: 14 },
});
