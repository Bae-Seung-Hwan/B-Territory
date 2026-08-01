import { apiClient } from '@/lib/api-client';

export interface Spot {
  id: number;
  contentId: string;
  title: string;
  addr1: string | null;
  // TypeORM decimal 컬럼은 pg 드라이버가 string으로 반환한다 (transformer 미설정)
  mapX: string | number | null;
  mapY: string | number | null;
  firstimage: string | null;
  contenttypeid: string | null;
  areacode: string | null;
  sigungucode: string | null;
}

/** GET /api/spots/:id — 목록 필드 전부 + 상세 필드 */
export interface SpotDetail extends Spot {
  overview: string | null;
  usetime: string | null;
  homepage: string | null;
}

interface SpotListResponse {
  items: Spot[];
  total: number;
  page: number;
  limit: number;
}

const BUSAN_AREA_CODE = '6';

export async function fetchBusanSpots(): Promise<Spot[]> {
  const { data } = await apiClient.get<SpotListResponse>('/api/spots', {
    params: { areacode: BUSAN_AREA_CODE, limit: 500 },
  });
  return data.items;
}

export async function fetchSpotDetail(id: number): Promise<SpotDetail> {
  const { data } = await apiClient.get<SpotDetail>(`/api/spots/${id}`);
  return data;
}
