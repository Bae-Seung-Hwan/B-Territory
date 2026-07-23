import { forwardRef, ReactNode, useCallback } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { BrandColors } from '@/constants/theme';

interface BottomSheetProps {
  children: ReactNode;
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  /** 기본 padding:16을 덮어써야 할 때(예: 내부에서 자체 여백을 관리하는 경우) 사용 */
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * @gorhom/bottom-sheet의 BottomSheetModal을 BrandColors 톤 + 탭-바깥-닫힘 backdrop으로
 * 얇게 래핑한 것. 사용법: ref로 present()/dismiss() 호출 (Gorhom의 표준 imperative API 그대로).
 */
export const BottomSheet = forwardRef<BottomSheetModal, BottomSheetProps>(
  ({ children, snapPoints = ['50%'], onDismiss, contentStyle }, ref) => {
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
      ),
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        onDismiss={onDismiss}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={[styles.content, contentStyle]}>{children}</BottomSheetView>
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
