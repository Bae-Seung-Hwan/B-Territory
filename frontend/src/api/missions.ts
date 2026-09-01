import { apiClient } from '@/lib/api-client';

/** POST /api/missions/checkin — 현장 GPS(50m) 검증 후 24시간 방문 창을 연다. */
export interface CheckinResult {
  success: true;
  spotId: number;
  expiresInSeconds: number;
}

export async function checkinMission(spotId: number, lat: number, lng: number): Promise<CheckinResult> {
  const { data } = await apiClient.post<CheckinResult>('/api/missions/checkin', { spotId, lat, lng });
  return data;
}

/** POST /api/missions/review — 사전 체크인 전제, 관광지별 인당 하루 1회(KST 자정 리셋). */
export interface ReviewMissionResult {
  success: true;
  spotId: number;
  team: string;
  type: 'MISSION_REVIEW';
  pointsAwarded: number;
  teamPointsAwarded: number;
}

export async function submitReviewMission(
  spotId: number,
  rating: number,
  content?: string,
): Promise<ReviewMissionResult> {
  const { data } = await apiClient.post<ReviewMissionResult>('/api/missions/review', {
    spotId,
    rating,
    content: content?.trim() ? content.trim() : undefined,
  });
  return data;
}

/** GET /api/missions/reviews — 관광지 리뷰 목록(최신순 최대 50건) + 평균 별점. */
export interface ReviewItem {
  id: number;
  rating: number;
  content: string | null;
  team: string;
  createdAt: string;
  nickname: string | null;
}

export interface ReviewList {
  spotId: number;
  count: number;
  averageRating: number | null;
  items: ReviewItem[];
}

export async function fetchSpotReviews(spotId: number): Promise<ReviewList> {
  const { data } = await apiClient.get<ReviewList>('/api/missions/reviews', { params: { spotId } });
  return data;
}
