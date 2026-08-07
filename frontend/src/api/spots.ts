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
  // PR #30(백엔드, 다국어 설명)부터 내려주는 필드. 머지 전 백엔드에서는 undefined로 온다 —
  // description을 항상 optional chaining으로 읽고 overview로 폴백해야 하는 이유.
  overviewEn?: string | null;
  description?: string | null;
  lang?: 'ko' | 'en';
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

/** lang: 'ko'/'en' 또는 국가코드. 생략 시 백엔드 기본(ko) — 구 백엔드는 이 파라미터를 무시한다. */
export async function fetchSpotDetail(id: number, lang?: string): Promise<SpotDetail> {
  const { data } = await apiClient.get<SpotDetail>(`/api/spots/${id}`, {
    params: lang ? { lang } : undefined,
  });
  return data;
}
