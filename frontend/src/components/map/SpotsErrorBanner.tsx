import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

export function SpotsErrorBanner({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { top: insets.top + 16 }]}>
      <TouchableOpacity style={styles.pill} onPress={onPress}>
        <Text style={styles.text}>{t('map.spotsLoadError')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    backgroundColor: `${BrandColors.danger}E6`, // 0.9 alpha
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
