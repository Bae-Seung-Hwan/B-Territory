import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, TextInput } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { BrandColors } from '@/constants/theme';
import { queryKeys } from '@/lib/query-keys';
import { fetchSpotReviews } from '@/api/missions';
import { useReviewMission, type MissionFeedback } from '@/hooks/use-review-mission';
import { useTranslation } from '@/i18n';

// BottomSheetTextInput의 blur 처리가 web에서 크래시 난다(register.tsx의 CountrySearchInput과
// 동일한 이유) — native에서만 바텀시트 전용 입력을 쓴다.
const ContentInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

const STARS = [1, 2, 3, 4, 5];

interface ReviewMissionSectionProps {
  spotId: number;
  coords: { latitude: number; longitude: number } | null;
}

/**
 * 리뷰 작성 미션 — 사전 체크인(GPS 50m) 후 별점+리뷰를 등록한다.
 * SpotDetailSheet가 시트를 닫을 때(spot → null)마다 이 컴포넌트를 통째로 언마운트한다 —
 * 별점·본문 같은 로컬 입력 상태는 그걸로 함께 초기화되므로 별도 reset 배선이 필요 없다.
 * 체크인 여부만은 예외로, 언마운트를 견디도록 useReviewMission이 기기에 따로 보존한다
 * (그러지 않으면 체크인 후 시트를 닫고 자리를 옮기는 흐름 자체가 불가능해진다).
 */
export function ReviewMissionSection({ spotId, coords }: ReviewMissionSectionProps) {
  const { t } = useTranslation();
  const { checkin, review, checkedIn, checkinFeedback, reviewFeedback } = useReviewMission(spotId);
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');

  const { data: reviews } = useQuery({
    queryKey: queryKeys.missions.reviews(spotId),
    queryFn: () => fetchSpotReviews(spotId),
  });
  const submitted = review.isSuccess;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('map.reviewMission.title')}</Text>

      {reviews && reviews.count > 0 && (
        <Text style={styles.summary}>
          {t('map.reviewMission.summary', {
            count: reviews.count,
            average: reviews.averageRating?.toFixed(1) ?? '—',
          })}
        </Text>
      )}

      {!checkedIn && !submitted && (
        <View>
          <Button
            title={t('map.reviewMission.checkinButton')}
            onPress={() => coords && checkin.mutate({ lat: coords.latitude, lng: coords.longitude })}
            disabled={!coords}
            loading={checkin.isPending}
            variant="secondary"
          />
          {!coords && <Text style={styles.hint}>{t('map.missions.GPS_VISIT.blocked')}</Text>}
          {checkinFeedback && (
            <Text style={[styles.feedback, feedbackStyle(checkinFeedback.tone)]}>
              {checkinFeedback.text}
            </Text>
          )}
        </View>
      )}

      {checkedIn && !submitted && (
        <View style={styles.form}>
          <View style={styles.starsRow}>
            {STARS.map((value) => (
              <Pressable key={value} onPress={() => setRating(value)} hitSlop={6}>
                <Text style={[styles.star, value <= rating && styles.starFilled]}>★</Text>
              </Pressable>
            ))}
          </View>
          <ContentInput
            style={styles.input}
            placeholder={t('map.reviewMission.contentPlaceholder')}
            placeholderTextColor="#666"
            value={content}
            onChangeText={setContent}
            maxLength={1000}
            multiline
          />
          <Button
            title={t('map.reviewMission.submitButton')}
            onPress={() => review.mutate({ rating, content })}
            disabled={rating < 1}
            loading={review.isPending}
          />
          {reviewFeedback && (
            <Text style={[styles.feedback, feedbackStyle(reviewFeedback.tone)]}>
              {reviewFeedback.text}
            </Text>
          )}
        </View>
      )}

      {submitted && (
        <Text style={[styles.feedback, styles.feedbackSuccess]}>{reviewFeedback?.text}</Text>
      )}
    </View>
  );
}

function feedbackStyle(tone: MissionFeedback['tone']) {
  return tone === 'success' ? styles.feedbackSuccess : styles.feedbackError;
}

const styles = StyleSheet.create({
  container: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BrandColors.border, gap: 8 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  summary: { color: '#b0b4ba', fontSize: 12 },
  hint: { marginTop: 4, color: '#888', fontSize: 12, textAlign: 'center' },
  form: { gap: 8 },
  starsRow: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 28, color: BrandColors.border },
  starFilled: { color: '#FFD700' },
  input: {
    minHeight: 60,
    backgroundColor: BrandColors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.border,
    color: '#fff',
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  feedback: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  feedbackSuccess: { color: BrandColors.accent },
  feedbackError: { color: BrandColors.danger },
});
