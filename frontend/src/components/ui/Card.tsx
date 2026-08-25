import { ReactNode } from 'react';
import { View, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { BrandColors, Spacing } from '@/constants/theme';

interface CardProps {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, selected = false, onPress, style }: CardProps) {
  const cardStyle = [styles.base, selected && styles.selected, style];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    padding: Spacing.three,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
  },
  selected: { borderColor: BrandColors.accent },
});
