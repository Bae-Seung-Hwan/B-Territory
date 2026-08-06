import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandColors } from '@/constants/theme';

interface LocateMeButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export function LocateMeButton({ onPress, disabled = false }: LocateMeButtonProps) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { bottom: insets.bottom + 24, opacity: disabled ? 0.4 : 1 }]}
      hitSlop={8}
    >
      <Ionicons name="locate" size={22} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${BrandColors.surface}F2`, // 0.95 alpha
    borderWidth: 1,
    borderColor: BrandColors.border,
    zIndex: 10,
  },
});
