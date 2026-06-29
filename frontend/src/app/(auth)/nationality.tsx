import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '@/store/useUserStore';

const NATIONALITIES = [
  { code: 'KR', label: '🇰🇷 한국' },
  { code: 'JP', label: '🇯🇵 일본' },
  { code: 'US', label: '🇺🇸 미국' },
  { code: 'CN', label: '🇨🇳 중국' },
  { code: 'FR', label: '🇫🇷 프랑스' },
];

export default function NationalityScreen() {
  const router = useRouter();
  const { setNationality, setAuthenticated } = useUserStore();

  const handleSelect = (code: string) => {
    setNationality(code);
    setAuthenticated(true);
    router.replace('/(main)/map');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>국적을 선택하세요</Text>
      <Text style={styles.subtitle}>같은 국적 관광객과 팀이 됩니다</Text>
      <FlatList
        data={NATIONALITIES}
        keyExtractor={(item) => item.code}
        style={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => handleSelect(item.code)}>
            <Text style={styles.itemText}>{item.label}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#0A0A0F',
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: '#888', marginTop: 8, marginBottom: 32 },
  list: { width: '100%' },
  item: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    marginBottom: 12,
  },
  itemText: { fontSize: 18, color: '#fff', textAlign: 'center' },
});
