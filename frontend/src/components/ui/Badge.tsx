import { View, Text, StyleSheet } from 'react-native';
import { BrandColors, Spacing } from '@/constants/theme';

export type BadgeVariant = 'default' | 'accent' | 'danger';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
  return (
    <View style={[styles.base, variantStyles[variant]]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

const variantStyles = StyleSheet.create({
  default: { backgroundColor: BrandColors.surface, borderWidth: 1, borderColor: BrandColors.border },
  accent: { backgroundColor: BrandColors.accent },
  danger: { backgroundColor: BrandColors.danger },
});
