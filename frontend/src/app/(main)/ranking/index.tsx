import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  fetchTeamRanking,
  fetchUserRanking,
  fetchTeamRecords,
  fetchUserRecords,
  type TeamRankEntry,
  type UserRankEntry,
  type TeamOccupationRecord,
  type TeamDuelWinRecord,
  type UserCountRecord,
  type UserWinRateRecord,
} from '@/api/ranking';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from '@/i18n';
import { getCountryList } from '@/constants/countries';
import { HALL_OF_FAME_RECORDS_ENABLED } from '@/config/feature-flags';
import { Card } from '@/components/ui/Card';
import { BrandColors, Spacing } from '@/constants/theme';

// 시즌 랭킹 캐시 TTL(진행 중 60초, hall-of-fame.service.ts LIVE_TTL_SEC)에 맞춘 폴링 주기.
// 이보다 짧게 돌려도 백엔드가 같은 캐시 값을 돌려주므로 의미가 없다.
const SEASON_POLL_MS = 60_000;
// 명예의 전당 표시 상한 — 백엔드는 최대 100건까지 주지만 목록이 길어지면 스크롤이 무거워진다.
const RECORDS_DISPLAY_LIMIT = 10;

type RankingView = 'season' | 'hallOfFame';
type Scope = 'teams' | 'users';

export default function RankingScreen() {
  const { t, locale } = useTranslation();
  const [view, setView] = useState<RankingView>('season');
  const [scope, setScope] = useState<Scope>('teams');

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const flagByTeam = useMemo(
    () => new Map(countries.map((c) => [c.code, c.flag])),
    [countries],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>{t('ranking.title')}</Text>

      <View style={styles.segmentRow}>
        <Segment
          label={t('ranking.tabs.season')}
          active={view === 'season'}
          onPress={() => setView('season')}
        />
        <Segment
          label={t('ranking.tabs.hallOfFame')}
          active={view === 'hallOfFame'}
          onPress={() => setView('hallOfFame')}
        />
      </View>

      {view === 'season' ? (
        <SeasonRankingView scope={scope} onScopeChange={setScope} flagByTeam={flagByTeam} />
      ) : (
        <HallOfFameView flagByTeam={flagByTeam} />
      )}
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

/** 초 단위 지속시간을 "N일 M시간"/"N일" 형태로 표시 — 프로젝트에 날짜 라이브러리가 없어 직접 계산한다. */
function formatDuration(t: (key: string, opts?: Record<string, unknown>) => string, seconds: number) {
  const totalHours = Math.floor(seconds / 3600);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return t('ranking.hallOfFame.durationDays', { days, hours });
  return t('ranking.hallOfFame.durationHoursOnly', { hours });
}

function HallOfFameView({ flagByTeam }: { flagByTeam: Map<string, string> }) {
  const { t } = useTranslation();

  const teamRecordsQuery = useQuery({
    queryKey: queryKeys.ranking.teamRecords,
    queryFn: fetchTeamRecords,
    enabled: HALL_OF_FAME_RECORDS_ENABLED,
  });
  const userRecordsQuery = useQuery({
    queryKey: queryKeys.ranking.userRecords,
    queryFn: fetchUserRecords,
    enabled: HALL_OF_FAME_RECORDS_ENABLED,
  });

  // 백엔드(records/teams·records/users)가 아직 없다 — 존재하지 않는 엔드포인트를
  // 조회하는 대신 준비 중 안내만 보여준다. 플래그가 켜지면 이 분기가 자연히 없어진다.
  if (!HALL_OF_FAME_RECORDS_ENABLED) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{t('ranking.hallOfFame.disabledBanner')}</Text>
      </View>
    );
  }

  const isLoading = teamRecordsQuery.isLoading || userRecordsQuery.isLoading;
  const isError = teamRecordsQuery.isError || userRecordsQuery.isError;

  if (isLoading) {
    return <ActivityIndicator style={styles.loading} color={BrandColors.accent} />;
  }

  if (isError) {
    return (
      <Pressable
        style={styles.errorBox}
        onPress={() => {
          teamRecordsQuery.refetch();
          userRecordsQuery.refetch();
        }}
      >
        <Text style={styles.errorText}>{t('ranking.loadFailed')}</Text>
        <Text style={styles.retryText}>{t('ranking.retry')}</Text>
      </Pressable>
    );
  }

  const longestOccupation = teamRecordsQuery.data?.longestOccupation ?? [];
  const mostDuelWinsTeams = teamRecordsQuery.data?.mostDuelWins ?? [];
  const mostVisits = userRecordsQuery.data?.mostVisits ?? [];
  const mostMissions = userRecordsQuery.data?.mostMissions ?? [];
  const duelWinRate = userRecordsQuery.data?.duelWinRate ?? [];

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.sectionTitle}>{t('ranking.hallOfFame.teamSection')}</Text>
      <RecordSection
        title={t('ranking.hallOfFame.longestOccupation')}
        data={longestOccupation}
        emptyText={t('ranking.hallOfFame.empty')}
        renderItem={(item: TeamOccupationRecord) => (
          <Card key={`${item.team}-${item.sigungucode}`} style={styles.recordRow}>
            <Text style={styles.rowLabel}>
              {(flagByTeam.get(item.team) ?? '') + ' ' + item.team}
            </Text>
            <Text style={styles.rowScore}>{formatDuration(t, item.durationSeconds)}</Text>
          </Card>
        )}
      />
      <RecordSection
        title={t('ranking.hallOfFame.mostDuelWins')}
        data={mostDuelWinsTeams}
        emptyText={t('ranking.hallOfFame.empty')}
        renderItem={(item: TeamDuelWinRecord) => (
          <Card key={item.team} style={styles.recordRow}>
            <Text style={styles.rowLabel}>
              {(flagByTeam.get(item.team) ?? '') + ' ' + item.team}
            </Text>
            <Text style={styles.rowScore}>
              {t('ranking.hallOfFame.winsLabel', { wins: item.wins })}
            </Text>
          </Card>
        )}
      />

      <Text style={styles.sectionTitle}>{t('ranking.hallOfFame.userSection')}</Text>
      <RecordSection
        title={t('ranking.hallOfFame.mostVisits')}
        data={mostVisits}
        emptyText={t('ranking.hallOfFame.empty')}
        renderItem={(item: UserCountRecord) => (
          <Card key={item.userId} style={styles.recordRow}>
            <Text style={styles.rowLabel}>
              {(flagByTeam.get(item.team) ?? '') + ' ' + item.nickname}
            </Text>
            <Text style={styles.rowScore}>{item.count}</Text>
          </Card>
        )}
      />
      <RecordSection
        title={t('ranking.hallOfFame.mostMissions')}
        data={mostMissions}
        emptyText={t('ranking.hallOfFame.empty')}
        renderItem={(item: UserCountRecord) => (
          <Card key={item.userId} style={styles.recordRow}>
            <Text style={styles.rowLabel}>
              {(flagByTeam.get(item.team) ?? '') + ' ' + item.nickname}
            </Text>
            <Text style={styles.rowScore}>{item.count}</Text>
          </Card>
        )}
      />
      <RecordSection
        title={t('ranking.hallOfFame.duelWinRate')}
        data={duelWinRate}
        emptyText={t('ranking.hallOfFame.empty')}
        renderItem={(item: UserWinRateRecord) => (
          <Card key={item.userId} style={styles.recordRow}>
            <Text style={styles.rowLabel}>
              {(flagByTeam.get(item.team) ?? '') + ' ' + item.nickname}
            </Text>
            <Text style={styles.rowScore}>
              {t('ranking.hallOfFame.winLossLabel', {
                wins: item.wins,
                losses: item.losses,
              })}
              {` · ${Math.round(item.winRate * 100)}%`}
            </Text>
          </Card>
        )}
      />
    </ScrollView>
  );
}

function RecordSection<T>({
  title,
  data,
  emptyText,
  renderItem,
}: {
  title: string;
  data: T[];
  emptyText: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const visible = data.slice(0, RECORDS_DISPLAY_LIMIT);
  return (
    <View style={styles.recordSection}>
      <Text style={styles.recordSectionTitle}>{title}</Text>
      {visible.length === 0 ? (
        <Text style={styles.emptyText}>{emptyText}</Text>
      ) : (
        visible.map((item) => renderItem(item))
      )}
    </View>
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
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: Spacing.three, marginBottom: Spacing.two },
  recordSection: { marginBottom: Spacing.three },
  recordSectionTitle: { color: '#999', fontSize: 13, fontWeight: '600', marginBottom: Spacing.one },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
    paddingVertical: Spacing.two,
  },
});
