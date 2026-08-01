const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** GET /api/claims/spots/:spotId — 아직 아무도 점령하지 않았으면 team/claimedAt이 null */
export interface SpotClaim {
  spotId: number;
  team: string | null;
  claimedAt: string | null;
}

export async function fetchSpotClaim(spotId: number): Promise<SpotClaim> {
  const res = await fetch(`${API_URL}/api/claims/spots/${spotId}`);
  if (!res.ok) throw new Error(`점령 현황 조회 실패: ${res.status}`);
  return res.json();
}
