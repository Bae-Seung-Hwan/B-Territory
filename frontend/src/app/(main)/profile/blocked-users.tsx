import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/i18n';
import { BrandColors, Spacing } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { useBlockedUsers, useUnblockMutation, moderationErrorMessage } from '@/hooks/use-moderation';
import type { BlockedUser } from '@/api/moderation';

/**
 * 행마다 자기 useUnblockMutation() 인스턴스를 갖는다 — 화면 전체가 하나를 공유하면
 * A를 해제하는 동안 그 mutation의 isPending/variables가 B·C에도 걸려, 여러 행을
 * 빠르게 잇달아 해제할 때 "지금 어느 행이 실제로 진행 중인지"가 마지막 호출
 * 하나로만 뭉개진다. 행마다 독립시키면 각자의 pending 상태가 정확히 자기 행만 가리킨다.
 */
function BlockedUserRow({ user }: { user: BlockedUser }) {
  const { t, locale } = useTranslation();
  const unblockMutation = useUnblockMutation();

  const handleUnblock = () => {
    Alert.alert(
      t('moderation.unblockConfirmTitle'),
      t('moderation.unblockConfirmMessage', { nickname: user.nickname }),
      [
        { text: t('moderation.cancel'), style: 'cancel' },
        {
          text: t('moderation.unblock'),
          style: 'destructive',
          onPress: () =>
            unblockMutation.mutate(user.userId, {
              onError: (err) => Alert.alert(t('auth.errors.title'), moderationErrorMessage(err, t)),
            }),
        },
      ],
    );
  };

  return (
    <Card style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.nickname}>{user.nickname}</Text>
        <Text style={styles.blockedAt}>
          {t('moderation.blockedAtLabel')}: {new Date(user.blockedAt).toLocaleDateString(locale)}
        </Text>
      </View>
      {unblockMutation.isPending ? (
        <ActivityIndicator color={BrandColors.accent} />
      ) : (
        <TouchableOpacity onPress={handleUnblock} hitSlop={8}>
          <Text style={styles.unblockText}>{t('moderation.unblock')}</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: blocked, isLoading, isError, refetch } = useBlockedUsers();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('moderation.blockedUsersTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading && <ActivityIndicator style={styles.loading} color={BrandColors.accent} />}

      {isError && (
        <TouchableOpacity style={styles.errorBox} onPress={() => refetch()}>
          <Text style={styles.errorText}>{t('moderation.errors.failed')}</Text>
          <Text style={styles.retryText}>{t('moderation.retry')}</Text>
        </TouchableOpacity>
      )}

      {blocked && (
        <FlatList
          data={blocked}
          keyExtractor={(item) => item.userId}
          renderItem={({ item }) => <BlockedUserRow user={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyState}>{t('moderation.blockedUsersEmpty')}</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerSpacer: { width: 24 },
  loading: { marginTop: Spacing.five },
  errorBox: { alignItems: 'center', marginTop: Spacing.five },
  errorText: { color: '#ccc', fontSize: 14, marginBottom: 4 },
  retryText: { color: BrandColors.accent, fontSize: 13, fontWeight: '600' },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  emptyState: { color: '#555', fontSize: 14, textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowInfo: { gap: 4 },
  nickname: { color: '#fff', fontSize: 15, fontWeight: '600' },
  blockedAt: { color: '#888', fontSize: 12 },
  unblockText: { color: BrandColors.danger, fontSize: 13, fontWeight: '700' },
});
