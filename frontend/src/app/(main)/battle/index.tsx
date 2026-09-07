import { FlatList, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { useBattleStore, selectSortedEnemies, type NearbyEnemy } from '@/store/useBattleStore';
import { useSocket } from '@/providers/SocketProvider';
import { BattleEnemyRow } from '@/components/battle/BattleEnemyRow';

export default function BattleScreen() {
  const { t } = useTranslation();
  // selectSortedEnemies는 매번 새 배열을 만든다 — useShallow로 감싸 값이 실제로
  // 바뀌지 않으면 이전 배열 참조를 그대로 돌려줘야 무한 리렌더 루프가 안 생긴다
  // ("getSnapshot should be cached" / Maximum update depth exceeded).
  const enemies = useBattleStore(useShallow(selectSortedEnemies));
  const socket = useSocket();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FlatList
        data={enemies}
        keyExtractor={(item: NearbyEnemy) => item.userId}
        renderItem={({ item }) => <BattleEnemyRow enemy={item} socket={socket} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.emptyState}>{t('battle.emptyState')}</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  list: { padding: 16, flexGrow: 1 },
  separator: { height: 8 },
  emptyState: { color: '#555', fontSize: 14, textAlign: 'center', marginTop: 40 },
});
