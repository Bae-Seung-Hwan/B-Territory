import { apiClient } from '@/lib/api-client';

/** GET /api/districts/:code — 부산 구·군 마스터. 숫자 컬럼은 pg decimal이라 문자열로 온다. */
export interface District {
  id: number;
  sigunguCode: string;
  nameKo: string;
  nameEn: string;
  centerLat: string | null;
  centerLng: string | null;
  foreignVisitorShare: string | null;
  /** 점령 점수 가중치 — 외국인 방문 비중이 높은 구일수록 크다 */
  scoreWeight: string;
}

/** GET /api/claims/districts/:sigungucode — 아직 집계 전이면 team/calculatedAt이 null */
export interface DistrictClaim {
  sigungucode: string;
  team: string | null;
  teamScore: number;
  calculatedAt: string | null;
}

/** GET /api/districts/capital/current — 이번 주 수도. 미지정 시 sigunguCode/district가 null이고 multiplier는 1. */
export interface CurrentCapital {
  sigunguCode: string | null;
  multiplier: number;
  district: District | null;
}

export async function fetchDistrict(sigunguCode: string): Promise<District> {
  const { data } = await apiClient.get<District>(`/api/districts/${sigunguCode}`);
  return data;
}

export async function fetchCurrentCapital(): Promise<CurrentCapital> {
  const { data } = await apiClient.get<CurrentCapital>('/api/districts/capital/current');
  return data;
}

export async function fetchDistrictClaim(sigunguCode: string): Promise<DistrictClaim> {
  const { data } = await apiClient.get<DistrictClaim>(`/api/claims/districts/${sigunguCode}`);
  return data;
}
