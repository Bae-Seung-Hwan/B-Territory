import { Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';

export default function SpotsScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{t('spots.title')}</Text>
      <Text style={styles.placeholder}>{t('spots.placeholder')}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0F' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  placeholder: { color: '#555', fontSize: 14 },
});
