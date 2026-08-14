import { forwardRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandColors, withAlpha } from '@/constants/theme';
import { queryKeys } from '@/lib/query-keys';
import { fetchDistrict, fetchDistrictClaim } from '@/api/districts';
import { getDistrictFillColor, CAPITAL_STROKE_COLOR } from '@/utils/districtColors';
import { useGameStore } from '@/store/useGameStore';
import { useTranslation } from '@/i18n';

interface DistrictDetailSheetProps {
  /** 탭한 구의 SIG_CD(폴리곤 코드). null이면 시트가 닫힌 상태 */
  sigCd: string | null;
  /** 위 구의 백엔드 조회용 코드. 매핑에 없으면 null */
  sigunguCode: string | null;
  onDismiss: () => void;
}

/**
 * 마커가 보이지 않는 축척에서 구 폴리곤을 탭했을 때 뜨는 시트.
 *
 * 관광지 말풍선과 달리 네이티브 Callout을 쓰지 않는다 — 폴리곤에는 Callout 개념이 없고,
 * Android Callout은 열리는 순간의 내용을 비트맵으로 굳혀 비동기 조회와 잘 맞지 않는다.
 */
export const DistrictDetailSheet = forwardRef<BottomSheetModal, DistrictDetailSheetProps>(
  function DistrictDetailSheet({ sigCd, sigunguCode, onDismiss }, ref) {
    const { t } = useTranslation();
    const enabled = sigunguCode != null;
    const capitalDistrict = useGameStore((s) => s.capitalDistrict);
    const isCapital = capitalDistrict != null && capitalDistrict.sigunguCode === sigunguCode;

    const districtQuery = useQuery({
      queryKey: queryKeys.districts.detail(sigunguCode ?? ''),
      queryFn: () => fetchDistrict(sigunguCode!),
      enabled,
      // 구 마스터(이름·가중치)는 사실상 고정값이라 매번 받을 이유가 없다.
      staleTime: 60 * 60 * 1000,
    });

    // 점령 현황은 관광지와 같은 이유로 열 때마다 새로 받는다(수시로 바뀐다).
    const claimQuery = useQuery({
      queryKey: queryKeys.claims.district(sigunguCode ?? ''),
      queryFn: () => fetchDistrictClaim(sigunguCode!),
      enabled,
      staleTime: 0,
      gcTime: 0,
      retry: 1,
    });

    const district = districtQuery.data;
    const claim = claimQuery.data;
    const isLoading = districtQuery.isLoading || claimQuery.isLoading;
    const isError = districtQuery.isError || claimQuery.isError;

    return (
      <BottomSheet ref={ref} snapPoints={['40%']} onDismiss={onDismiss}>
        <BottomSheetView style={styles.content}>
          <View style={styles.titleRow}>
            {sigCd && (
              <View style={[styles.swatch, { backgroundColor: getDistrictFillColor(sigCd) }]} />
            )}
            <Text style={styles.title}>{district?.nameKo ?? '—'}</Text>
          </View>
          {district && <Text style={styles.subtitle}>{district.nameEn}</Text>}

          {isCapital && (
            <View style={styles.capitalBadge}>
              <Text style={styles.capitalText}>
                {t('map.districtDetail.capitalBadge', { multiplier: capitalDistrict!.multiplier })}
              </Text>
            </View>
          )}

          {isLoading && <ActivityIndicator style={styles.loading} color={BrandColors.accent} />}

          {isError && (
            <Pressable
              style={styles.errorBox}
              onPress={() => {
                districtQuery.refetch();
                claimQuery.refetch();
              }}
            >
              <Text style={styles.errorText}>{t('map.districtDetail.loadFailed')}</Text>
              <Text style={styles.retryText}>{t('map.districtDetail.retry')}</Text>
            </Pressable>
          )}

          {claim && (
            <>
              <View style={styles.claimBadge}>
                <Text style={styles.claimText}>
                  {claim.team
                    ? t('map.claim.claimedBy', { team: claim.team })
                    : t('map.claim.unclaimed')}
                </Text>
              </View>

              {/* 이 구의 보유팀이 마지막으로 확정된 시각. 집계 배치는 12시간마다 돌지만
                  이 값은 실제로 주인이 정해진 시점만 가리킨다(활동이 없으면 갱신되지 않는다). */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('map.districtDetail.claimedAt')}</Text>
                <Text style={styles.fieldValue}>
                  {claim.calculatedAt
                    ? new Date(claim.calculatedAt).toLocaleString()
                    : t('map.districtDetail.notAggregated')}
                </Text>
              </View>
            </>
          )}

          {district && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('map.districtDetail.scoreWeight')}</Text>
              <Text style={styles.fieldValue}>×{Number(district.scoreWeight).toFixed(2)}</Text>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

const styles = StyleSheet.create({
  content: { flex: 1, padding: 16, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 999 },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#b0b4ba', fontSize: 13 },
  loading: { marginTop: 12 },
  claimBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(BrandColors.accent, 0.15),
  },
  claimText: { color: BrandColors.accent, fontSize: 12, fontWeight: '700' },
  capitalBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(CAPITAL_STROKE_COLOR, 0.15),
  },
  capitalText: { color: CAPITAL_STROKE_COLOR, fontSize: 12, fontWeight: '700' },
  field: { gap: 2, marginTop: 6 },
  fieldLabel: { color: '#888', fontSize: 11 },
  fieldValue: { color: '#e6e6e6', fontSize: 14 },
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
