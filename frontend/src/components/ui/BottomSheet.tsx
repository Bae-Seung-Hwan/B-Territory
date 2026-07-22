import { forwardRef, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { BrandColors } from '@/constants/theme';

interface BottomSheetProps {
  children: ReactNode;
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
}

/**
 * @gorhom/bottom-sheet의 BottomSheetModal을 BrandColors 톤으로 얇게 래핑한 것.
 * 사용법: ref로 present()/dismiss() 호출 (Gorhom의 표준 imperative API 그대로).
 */
export const BottomSheet = forwardRef<BottomSheetModal, BottomSheetProps>(
  ({ children, snapPoints = ['50%'], onDismiss }, ref) => {
    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        onDismiss={onDismiss}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.content}>{children}</BottomSheetView>
      </BottomSheetModal>
    );
  },
);
BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
  background: { backgroundColor: BrandColors.surface },
  handleIndicator: { backgroundColor: BrandColors.border },
  content: { flex: 1, padding: 16 },
});
