import { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  fetchTeamRanking,
  fetchUserRanking,
  type TeamRankEntry,
  type UserRankEntry,
} from '@/api/ranking';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from '@/i18n';
import { getCountryList } from '@/constants/countries';
import { Card } from '@/components/ui/Card';
import { BrandColors, Spacing } from '@/constants/theme';

// 시즌 랭킹 캐시 TTL(진행 중 60초, hall-of-fame.service.ts LIVE_TTL_SEC)에 맞춘 폴링 주기.
// 이보다 짧게 돌려도 백엔드가 같은 캐시 값을 돌려주므로 의미가 없다.
const SEASON_POLL_MS = 60_000;

type Scope = 'teams' | 'users';

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
  // null = 서버 기본값(현재 시즌). 과거 시즌을 탐색하면 명시적인 번호로 바뀐다.
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  // "진행 중"인 시즌이 곧 현재 시즌이다 — 이 판정만으로 폴링 여부와 "다음 시즌" 이동
  // 가능 여부를 모두 결정하면, 선택된 시즌 번호가 현재 시즌과 우연히 같아져도(예: 이전
  // 시즌들을 거쳐 다시 돌아온 경우) 별도 상태 없이 자연히 맞아떨어진다. status는 아직
  // 응답이 없으면 undefined라 selectedSeason이 null일 때만 우선 폴링을 켠다.
  const teamQuery = useQuery({
    queryKey: queryKeys.ranking.teams(selectedSeason ?? undefined),
    queryFn: () => fetchTeamRanking(selectedSeason ?? undefined),
    enabled: scope === 'teams',
    refetchInterval: (query) =>
      selectedSeason === null || query.state.data?.status === 'ongoing' ? SEASON_POLL_MS : false,
  });
  const userQuery = useQuery({
    queryKey: queryKeys.ranking.users(selectedSeason ?? undefined),
    queryFn: () => fetchUserRanking(selectedSeason ?? undefined),
    enabled: scope === 'users',
    refetchInterval: (query) =>
      selectedSeason === null || query.state.data?.status === 'ongoing' ? SEASON_POLL_MS : false,
  });

  const query = scope === 'teams' ? teamQuery : userQuery;
  const resolvedSeason = query.data?.season ?? null;
  const status = query.data?.status;
  const isLiveSeason = selectedSeason === null || status === 'ongoing';
  const canGoPrevious = resolvedSeason !== null && resolvedSeason > 1;
  const canGoNext = status === 'ended';

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
        <Pressable
          onPress={() => resolvedSeason !== null && setSelectedSeason(resolvedSeason - 1)}
          disabled={!canGoPrevious}
          hitSlop={8}
        >
          <Text style={[styles.seasonNavArrow, !canGoPrevious && styles.seasonNavArrowDisabled]}>
            {'◀ ' + t('ranking.seasonNav.previous')}
          </Text>
        </Pressable>
        <Text style={styles.seasonLabel}>
          {resolvedSeason !== null
            ? t('ranking.seasonNav.seasonLabel', { season: resolvedSeason })
            : '—'}
        </Text>
        <Pressable
          onPress={() => resolvedSeason !== null && setSelectedSeason(resolvedSeason + 1)}
          disabled={!canGoNext}
          hitSlop={8}
        >
          <Text style={[styles.seasonNavArrow, !canGoNext && styles.seasonNavArrowDisabled]}>
            {t('ranking.seasonNav.next') + ' ▶'}
          </Text>
        </Pressable>
      </View>

      {!isLiveSeason && (
        <Pressable onPress={() => setSelectedSeason(null)}>
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
