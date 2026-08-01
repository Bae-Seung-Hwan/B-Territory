import { memo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CATEGORY_META } from '@/constants/mapCategories';
import { isCategoryZoomHidden } from '@/utils/mapZoom';
import { useTranslation } from '@/i18n';
import { BrandColors, withAlpha } from '@/constants/theme';

const HEADER_HEIGHT = 32;
const PANEL_GAP = 6;
const BOTTOM_OFFSET = 18;

interface CategoryFilterPanelProps {
  activeCategories: Record<string, boolean>;
  onToggleCategory: (id: string) => void;
  onToggleAll: () => void;
  zoom: number;
}

export const CategoryFilterPanel = memo(function CategoryFilterPanel({
  activeCategories,
  onToggleCategory,
  onToggleAll,
  zoom,
}: CategoryFilterPanelProps) {
  const insets = useSafeAreaInsets();
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  // 헤더와 리스트를 하나의 박스로 두고 접혔다 펴질 때 박스 높이를 바꾸면(예: column-reverse로
  // bottom 고정 변에 헤더를 붙이는 방식) 절대배치 + flex-direction 반전 조합에서 터치 판정이
  // 실제 화면 위치와 어긋나는 경우가 있어, 헤더를 아예 별도의 고정 높이/고정 위치 박스로 분리했다.
  // 리스트는 그 위에 뜨는 독립된 박스라 접힘 상태가 헤더의 위치·크기에 전혀 영향을 주지 않는다.
  return (
    <>
      <View style={[styles.panelBox, styles.header, { bottom: insets.bottom + BOTTOM_OFFSET }]}>
        <Pressable style={styles.headerInner} onPress={() => setCollapsed((c) => !c)}>
          <Text style={styles.headerTitle}>{t('map.categoryFilter.title')}</Text>
          <Pressable style={styles.allButton} onPress={onToggleAll} hitSlop={6}>
            <Text style={styles.allButtonText}>{t('map.categoryFilter.all')}</Text>
          </Pressable>
        </Pressable>
      </View>
      {!collapsed && (
        <View
          style={[
            styles.panelBox,
            styles.list,
            { bottom: insets.bottom + BOTTOM_OFFSET + HEADER_HEIGHT + PANEL_GAP },
          ]}
        >
          {Object.entries(CATEGORY_META).map(([id, meta]) => {
            const active = activeCategories[id] !== false;
            const zoomHidden = active && isCategoryZoomHidden(id, zoom);
            return (
              <Pressable
                key={id}
                style={[styles.chip, !active && styles.chipOff]}
                onPress={() => onToggleCategory(id)}
              >
                <View style={[styles.dot, { backgroundColor: meta.color }]} />
                <Text style={styles.emoji}>{meta.emoji}</Text>
                <Text style={[styles.label, zoomHidden && styles.labelZoomHidden]}>
                  {t(`map.categories.${id}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  // 헤더 박스와 리스트 박스가 공유하는 표면 스타일
  panelBox: {
    position: 'absolute',
    left: 10,
    borderRadius: 12,
    backgroundColor: withAlpha(BrandColors.background, 0.85),
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.12),
    // OutOfBoundsBanner(bottom, left/right 12 - 화면 거의 전체 폭)가 같은 높이대에 겹치는데
    // 둘 다 zIndex 10이면 JSX상 나중에 렌더되는 배너가 위에 깔려 탭을 가로챈다. 배너는 탭이
    // 필요 없는 정보성 UI이고 이쪽은 실제 조작이 필요한 컨트롤이라 더 높은 zIndex로 우선시킨다.
    zIndex: 20,
  },
  header: {
    height: HEADER_HEIGHT,
    justifyContent: 'center',
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 8,
  },
  headerTitle: { fontSize: 11, color: '#c3c2b7' },
  allButton: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  allButtonText: { fontSize: 10, color: '#fff' },
  list: {
    padding: 6,
    gap: 3,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipOff: { opacity: 0.35 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  emoji: { fontSize: 12 },
  label: { fontSize: 12, color: '#fff' },
  labelZoomHidden: { textDecorationLine: 'line-through', opacity: 0.6 },
});
