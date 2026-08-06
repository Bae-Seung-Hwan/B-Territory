import { apiClient } from '@/lib/api-client';

/** GET /api/claims/spots/:spotId — 아직 아무도 점령하지 않았으면 team/claimedAt이 null */
export interface SpotClaim {
  spotId: number;
  team: string | null;
  claimedAt: string | null;
  // PR #30(백엔드, 다국어 설명)부터 내려주는 필드. 머지 전 백엔드에서는 undefined로 온다.
  spot?: {
    id: number;
    title: string;
    overview: string | null;
    overviewEn: string | null;
    description: string | null;
  } | null;
}

/** lang: 'ko'/'en' 또는 국가코드. 생략 시 백엔드 기본(ko) — 구 백엔드는 이 파라미터를 무시한다. */
export async function fetchSpotClaim(spotId: number, lang?: string): Promise<SpotClaim> {
  const { data } = await apiClient.get<SpotClaim>(`/api/claims/spots/${spotId}`, {
    params: lang ? { lang } : undefined,
  });
  return data;
}

/** 점령 자격을 증명하는 방식. 백엔드 MissionType과 값을 맞춘다. */
export type MissionType = 'GPS_VISIT';

/** 미션별 증빙. 새 미션이 생기면 여기에 멤버를 추가한다. */
export type ClaimMission = { type: 'GPS_VISIT'; lat: number; lng: number };

/** 점령 성공 응답. defenseSeconds 동안은 다른 팀이 이 관광지를 뺏을 수 없다. 서버는 미션
 *  종류와 무관하게 이 하나의 형태로만 응답한다(백엔드는 현재 GPS_VISIT 엔드포인트뿐). */
export interface ClaimResult {
  success: boolean;
  spotId: number;
  team: string;
  type: 'CLAIM_NEW' | 'CLAIM_REVISIT';
  pointsAwarded: number;
  teamPointsAwarded: number;
  defenseSeconds: number;
}

// 미션마다 엔드포인트와 본문이 다르므로, 그 차이는 이 함수 하나에만 둔다.
function requestOf(spotId: number, mission: ClaimMission): { url: string; body: unknown } {
  switch (mission.type) {
    case 'GPS_VISIT':
      return {
        url: '/api/claims/visit',
        body: { spotId, lat: mission.lat, lng: mission.lng },
      };
  }
}

/**
 * 점령 시도. 로그인 필요(Bearer 토큰은 apiClient 인터셉터가 붙인다).
 *
 * 실패는 상태 코드로 구분한다 — 400 자격 미달(사유는 미션마다 다르다), 401 미인증,
 * 403 결투 패배 페널티, 404 없는 관광지, 409 방어 시간 중 또는 일일 점령 제한.
 */
export async function attemptClaim(
  spotId: number,
  mission: ClaimMission,
): Promise<ClaimResult> {
  const { url, body } = requestOf(spotId, mission);
  const { data } = await apiClient.post<ClaimResult>(url, body);
  return data;
}
