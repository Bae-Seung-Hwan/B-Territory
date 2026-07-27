const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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

interface SpotListResponse {
  items: Spot[];
  total: number;
  page: number;
  limit: number;
}

const BUSAN_AREA_CODE = '6';

export async function fetchBusanSpots(): Promise<Spot[]> {
  const res = await fetch(`${API_URL}/api/spots?areacode=${BUSAN_AREA_CODE}&limit=500`);
  if (!res.ok) throw new Error(`관광지 목록 조회 실패: ${res.status}`);
  const data: SpotListResponse = await res.json();
  return data.items;
}
