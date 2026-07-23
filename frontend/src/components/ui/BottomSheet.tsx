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
  /**
   * 콘텐츠가 BottomSheetFlatList/BottomSheetScrollView 등 자체 스크롤을 가질 때 true.
   * BottomSheetView는 마운트 시 자신을 '정적 콘텐츠(VIEW)'로 등록해버려서, 그 안에
   * 스크롤 가능한 컴포넌트를 중첩하면 내부 스크롤(드래그)이 동작하지 않게 된다.
   * true면 BottomSheetView로 감싸지 않고 children을 그대로 전달한다.
   */
  scrollable?: boolean;
}

/**
 * @gorhom/bottom-sheet의 BottomSheetModal을 BrandColors 톤 + 탭-바깥-닫힘 backdrop으로
 * 얇게 래핑한 것. 사용법: ref로 present()/dismiss() 호출 (Gorhom의 표준 imperative API 그대로).
 */
export const BottomSheet = forwardRef<BottomSheetModal, BottomSheetProps>(
  ({ children, snapPoints = ['50%'], onDismiss, contentStyle, scrollable = false }, ref) => {
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
        {scrollable ? (
          children
        ) : (
          <BottomSheetView style={[styles.content, contentStyle]}>{children}</BottomSheetView>
        )}
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
