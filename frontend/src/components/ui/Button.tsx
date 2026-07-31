import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { BrandColors, Spacing } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.base, variantStyles[variant], isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabled: { backgroundColor: BrandColors.border },
  text: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: BrandColors.accent },
  secondary: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  danger: { backgroundColor: BrandColors.danger },
});
