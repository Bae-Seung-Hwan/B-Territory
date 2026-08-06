import { forwardRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { BrandColors, withAlpha } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/mapCategories';
import { queryKeys } from '@/lib/query-keys';
import { fetchSpotDetail, type Spot } from '@/api/spots';
import { availableMissions, missionButtonKey } from '@/constants/claimMissions';
import { useClaimAttempt } from '@/hooks/use-claim-attempt';
import { useTranslation } from '@/i18n';

interface SpotDetailSheetProps {
  /** 탭한 마커의 목록 데이터. null이면 시트가 닫힌 상태 */
  spot: Spot | null;
  /**
   * 점령 현황 문구. 시트를 여는 경로가 "마커 탭 → 말풍선 탭"뿐이고 그 과정에서 이미 조회를
   * 마쳤으므로, 여기서 다시 요청하지 않고 부모가 갖고 있는 값을 그대로 받아 쓴다.
   */
  claimText: string | null;
  /** 점령 미션(현재는 GPS 방문 인증)이 필요로 하는 현재 위치 */
  coords: { latitude: number; longitude: number } | null;
  onDismiss: () => void;
}

/**
 * 마커를 탭했을 때 뜨는 관광지 상세 시트.
 * 제목·주소·사진은 이미 갖고 있는 목록 데이터로 즉시 그리고, overview/이용시간/홈페이지만
 * GET /api/spots/:id로 따로 받아 채운다 — 네트워크를 기다리는 동안 빈 화면을 보이지 않기 위함.
 */
export const SpotDetailSheet = forwardRef<BottomSheetModal, SpotDetailSheetProps>(
  function SpotDetailSheet({ spot, claimText, coords, onDismiss }, ref) {
    const { t, locale } = useTranslation();
    const { attempt, isPending, reset, feedback, feedbackSpotId } = useClaimAttempt();
    const {
      data: detail,
      isLoading,
      isError,
      refetch,
    } = useQuery({
      queryKey: queryKeys.spots.detail(spot?.id ?? 0, locale),
      queryFn: () => fetchSpotDetail(spot!.id, locale),
      enabled: spot != null,
      // 설명·이용시간·홈페이지는 사실상 고정값이라 시트를 다시 열 때마다 받아올 이유가 없다
      // (점령 현황과 달리 실시간성이 필요 없다).
      staleTime: 5 * 60 * 1000,
    });

    const meta = getCategoryMeta(spot?.contenttypeid);
    const homepageUrl = extractUrl(detail?.homepage);

    // 시트를 닫으면(spot → null) 지난 시도 결과를 버린다. 같은 관광지를 다시 열었을 때
    // 이미 지나간 "점령 성공"이 그대로 떠 있으면 방금 성공한 것처럼 보인다.
    useEffect(() => reset(), [spot?.id, reset]);

    // 결과 문구는 그 시도를 한 관광지에서만 보여준다.
    const attemptFeedback = feedbackSpotId === spot?.id ? feedback : null;
    const missions = availableMissions({ coords });

    return (
      <BottomSheet ref={ref} snapPoints={['60%', '90%']} onDismiss={onDismiss} scrollable>
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          {spot && (
            <>
              {spot.firstimage && (
                <Image source={{ uri: spot.firstimage }} style={styles.image} contentFit="cover" />
              )}

              <View style={styles.titleRow}>
                <View style={[styles.categoryDot, { backgroundColor: meta.color }]} />
                <Text style={styles.emoji}>{meta.emoji}</Text>
                <Text style={styles.title}>{spot.title}</Text>
              </View>
              {spot.addr1 && <Text style={styles.addr}>{spot.addr1}</Text>}

              {claimText && (
                <View style={styles.claimBadge}>
                  <Text style={styles.claimText}>{claimText}</Text>
                </View>
              )}

              {/* 자격 판정은 서버가 하므로(방문 인증이면 50m) 여기서는 증빙이 아직 준비되지
                  않은 경우(blockedReasonKey)만 눌리지 않게 하고 이유를 안내한다. */}
              {missions.map(({ type, mission, blockedReasonKey }) => (
                <View key={type}>
                  <Button
                    title={t(missionButtonKey(type))}
                    onPress={() => mission && attempt({ spotId: spot.id, mission })}
                    disabled={mission == null}
                    loading={isPending}
                    style={styles.missionButton}
                  />
                  {blockedReasonKey && (
                    <Text style={styles.missionHint}>{t(blockedReasonKey)}</Text>
                  )}
                </View>
              ))}
              {attemptFeedback && (
                <Text
                  style={[
                    styles.attemptFeedback,
                    attemptFeedback.tone === 'success'
                      ? styles.attemptSuccess
                      : styles.attemptError,
                  ]}
                >
                  {attemptFeedback.text}
                </Text>
              )}

              {isLoading && <ActivityIndicator style={styles.loading} color={BrandColors.accent} />}

              {isError && (
                <Pressable style={styles.errorBox} onPress={() => refetch()}>
                  <Text style={styles.errorText}>{t('map.spotDetail.loadFailed')}</Text>
                  <Text style={styles.retryText}>{t('map.spotDetail.retry')}</Text>
                </Pressable>
              )}

              {detail && (
                <>
                  <Text style={styles.overview}>
                    {/* description은 lang에 맞춰 백엔드가 골라준 텍스트(영문 없으면 한국어로
                        폴백). 구 백엔드(PR #30 머지 전)는 이 필드가 없으므로 overview로 폴백한다. */}
                    {detail.description?.trim() ||
                      detail.overview?.trim() ||
                      t('map.spotDetail.noOverview')}
                  </Text>

                  {detail.usetime && (
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>{t('map.spotDetail.usetime')}</Text>
                      <Text style={styles.fieldValue}>{detail.usetime}</Text>
                    </View>
                  )}

                  {homepageUrl && (
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>{t('map.spotDetail.homepage')}</Text>
                      <Text style={styles.link} onPress={() => Linking.openURL(homepageUrl)}>
                        {homepageUrl}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);

// TourAPI의 homepage 필드는 순수 URL이 아니라 <a href="...">…</a> 같은 HTML 조각으로 오는
// 경우가 많아, Linking에 넘길 수 있는 URL만 뽑아낸다. 못 찾으면 링크를 아예 그리지 않는다.
function extractUrl(homepage: string | null | undefined): string | null {
  if (!homepage) return null;
  const match = homepage.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  image: { width: '100%', height: 180, borderRadius: 12, backgroundColor: BrandColors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  emoji: { fontSize: 15 },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700' },
  addr: { color: '#b0b4ba', fontSize: 13 },
  claimBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(BrandColors.accent, 0.15),
  },
  claimText: { color: BrandColors.accent, fontSize: 12, fontWeight: '700' },
  missionButton: { marginTop: 6 },
  missionHint: { marginTop: 4, color: '#888', fontSize: 12, textAlign: 'center' },
  attemptFeedback: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  attemptSuccess: { color: BrandColors.accent },
  attemptError: { color: BrandColors.danger },
  loading: { marginTop: 12 },
  overview: { color: '#e6e6e6', fontSize: 14, lineHeight: 21, marginTop: 4 },
  field: { gap: 2, marginTop: 6 },
  fieldLabel: { color: '#888', fontSize: 11 },
  fieldValue: { color: '#e6e6e6', fontSize: 14 },
  link: { color: BrandColors.accent, fontSize: 14, textDecorationLine: 'underline' },
  errorBox: {
    backgroundColor: withAlpha(BrandColors.danger, 0.15),
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginTop: 8,
  },
  errorText: { color: '#fff', fontSize: 13 },
  retryText: { color: BrandColors.accent, fontSize: 12, fontWeight: '600' },
});
