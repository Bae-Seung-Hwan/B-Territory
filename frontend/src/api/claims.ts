import { apiClient } from '@/lib/api-client';

/** GET /api/claims/spots/:spotId — 아직 아무도 점령하지 않았으면 team/claimedAt이 null */
export interface SpotClaim {
  spotId: number;
  team: string | null;
  claimedAt: string | null;
}

export async function fetchSpotClaim(spotId: number): Promise<SpotClaim> {
  const { data } = await apiClient.get<SpotClaim>(`/api/claims/spots/${spotId}`);
  return data;
}
