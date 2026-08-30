import { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TeamRankEntry, UserRankEntry } from '@/api/ranking';
import { useSeasonRanking, type RankingScope } from '@/hooks/use-season-ranking';
import { useTranslation } from '@/i18n';
import { getCountryList } from '@/constants/countries';
import { Card } from '@/components/ui/Card';
import { BrandColors, Spacing } from '@/constants/theme';

type Scope = RankingScope;

export default function RankingScreen() {
  const { t, locale } = useTranslation();
  const [scope, setScope] = useState<Scope>('teams');

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const flagByTeam = useMemo(
    () => new Map(countries.map((c) => [c.code, c.flag])),
    [countries],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>{t('ranking.title')}</Text>
      <SeasonRankingView scope={scope} onScopeChange={setScope} flagByTeam={flagByTeam} />
    </SafeAreaView>
  );
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.segment, active && styles.segmentActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SeasonRankingView({
  scope,
  onScopeChange,
  flagByTeam,
}: {
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  flagByTeam: Map<string, string>;
}) {
  const { t } = useTranslation();
  const {
    query,
    displaySeason,
    isLiveSeason,
    canGoPrevious,
    canGoNext,
    goToPrevious,
    goToNext,
    backToCurrent,
  } = useSeasonRanking(scope);

  return (
    <>
      <View style={styles.segmentRow}>
        <Segment
          label={t('ranking.scope.teams')}
          active={scope === 'teams'}
          onPress={() => onScopeChange('teams')}
        />
        <Segment
          label={t('ranking.scope.users')}
          active={scope === 'users'}
          onPress={() => onScopeChange('users')}
        />
      </View>

      <View style={styles.seasonNav}>
        <Pressable onPress={goToPrevious} disabled={!canGoPrevious} hitSlop={8}>
          <Text style={[styles.seasonNavArrow, !canGoPrevious && styles.seasonNavArrowDisabled]}>
            {'◀ ' + t('ranking.seasonNav.previous')}
          </Text>
        </Pressable>
        <Text style={styles.seasonLabel}>
          {displaySeason !== null
            ? t('ranking.seasonNav.seasonLabel', { season: displaySeason })
            : '—'}
        </Text>
        <Pressable onPress={goToNext} disabled={!canGoNext} hitSlop={8}>
          <Text style={[styles.seasonNavArrow, !canGoNext && styles.seasonNavArrowDisabled]}>
            {t('ranking.seasonNav.next') + ' ▶'}
          </Text>
        </Pressable>
      </View>

      {!isLiveSeason && (
        <Pressable onPress={backToCurrent}>
          <Text style={styles.backToCurrentText}>{t('ranking.seasonNav.backToCurrent')}</Text>
        </Pressable>
      )}

      {query.data && (
        <Text style={styles.seasonRangeText}>
          {t('ranking.seasonNav.range', {
            start: new Date(query.data.start).toLocaleDateString(),
            end: new Date(query.data.end).toLocaleDateString(),
          })}
          {' · '}
          {t(`ranking.seasonNav.status.${query.data.status}`)}
        </Text>
      )}

      {query.isLoading && (
        <ActivityIndicator style={styles.loading} color={BrandColors.accent} />
      )}

      {query.isError && (
        <Pressable style={styles.errorBox} onPress={() => query.refetch()}>
          <Text style={styles.errorText}>{t('ranking.loadFailed')}</Text>
          <Text style={styles.retryText}>{t('ranking.retry')}</Text>
        </Pressable>
      )}

      {query.data &&
        (scope === 'teams' ? (
          <FlatList
            data={query.data.ranking as TeamRankEntry[]}
            keyExtractor={(item) => `${item.rank}-${item.team}`}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>{t('ranking.empty')}</Text>}
            renderItem={({ item }) => (
              <RankRow
                rank={item.rank}
                label={`${flagByTeam.get(item.team) ?? ''} ${item.team}`.trim()}
                score={item.score}
              />
            )}
          />
        ) : (
          <FlatList
            data={query.data.ranking as UserRankEntry[]}
            keyExtractor={(item) => `${item.rank}-${item.userId}`}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>{t('ranking.empty')}</Text>}
            renderItem={({ item }) => (
              <RankRow
                rank={item.rank}
                label={`${flagByTeam.get(item.team) ?? ''} ${item.nickname}`.trim()}
                score={item.score}
              />
            )}
          />
        ))}
    </>
  );
}

function RankRow({ rank, label, score }: { rank: number; label: string; score: number }) {
  return (
    <Card style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rank}>{rank}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowScore}>{score}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background, paddingHorizontal: Spacing.three },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: Spacing.two, marginBottom: Spacing.two },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: BrandColors.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: Spacing.two,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: BrandColors.accent },
  segmentText: { color: '#888', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  seasonNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  seasonNavArrow: { color: BrandColors.accent, fontSize: 13, fontWeight: '600' },
  seasonNavArrowDisabled: { color: '#444' },
  seasonLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  backToCurrentText: {
    color: BrandColors.accent,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: Spacing.one,
  },
  seasonRangeText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  loading: { marginTop: Spacing.five },
  errorBox: { alignItems: 'center', marginTop: Spacing.five },
  errorText: { color: '#ccc', fontSize: 14, marginBottom: 4 },
  retryText: { color: BrandColors.accent, fontSize: 13, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: Spacing.two },
  list: { paddingBottom: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
    paddingVertical: Spacing.two,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  rank: { color: '#888', fontSize: 14, fontWeight: '700', width: 24 },
  rowLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowScore: { color: BrandColors.accent, fontSize: 15, fontWeight: '700' },
});
