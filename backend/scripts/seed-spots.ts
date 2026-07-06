import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.TOUR_API_KEY) throw new Error('TOUR_API_KEY 환경변수가 필요합니다.');
const REQUIRED_DB_VARS = ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'] as const;
for (const key of REQUIRED_DB_VARS) {
  if (!process.env[key]) throw new Error(`${key} 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.`);
}
const SERVICE_KEY = process.env.TOUR_API_KEY as string;
const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const AREA_CODE = '6'; // 부산
const NUM_OF_ROWS = 100;

interface TourItem {
  contentid: string;
  title: string;
  addr1?: string;
  mapx?: string;
  mapy?: string;
  firstimage?: string;
  contenttypeid?: string;
  areacode?: string;
  sigungucode?: string;
}

interface TourApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: { item: TourItem | TourItem[] };
      totalCount: number | string;
    };
  };
}

async function fetchPage(pageNo: number): Promise<{ items: TourItem[]; total: number }> {
  const params = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    numOfRows: String(NUM_OF_ROWS),
    pageNo: String(pageNo),
    MobileOS: 'ETC',
    MobileApp: 'BTerritorySeeder',
    _type: 'json',
    areaCode: AREA_CODE,
  });
  const url = `${BASE_URL}/areaBasedList2?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API HTTP 오류: ${res.status} ${res.statusText}`);
  const data: TourApiResponse = await res.json();

  const { resultCode, resultMsg } = data?.response?.header ?? {};
  if (resultCode !== '0000') throw new Error(`API 응답 오류: ${resultCode} ${resultMsg}`);

  const body = data?.response?.body;
  const raw = body?.items?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return { items, total: Number(body?.totalCount ?? 0) };
}

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  console.log('DB 연결 성공');

  try {
    // page 1을 한 번만 호출해 총 건수와 첫 페이지 데이터를 함께 확보
    const { total, items: page1Items } = await fetchPage(1);
    const totalPages = Math.ceil(total / NUM_OF_ROWS);
    console.log(`총 ${total}건 / ${totalPages}페이지`);

    let inserted = 0;
    let skipped = 0;

    for (let page = 1; page <= totalPages; page++) {
      process.stdout.write(`[${page}/${totalPages}] 처리 중...`);
      const items = page === 1 ? page1Items : (await fetchPage(page)).items;

      // 컬럼 목록은 spot.entity.ts와 동기화 필요 (overview, usetime, homepage는 areaBasedList2 미제공)
      await client.query('BEGIN');
      try {
        for (const item of items) {
          if (!item.title?.trim()) {
            console.warn(`title 없음, 스킵: contentid=${item.contentid}`);
            skipped++;
            continue;
          }

          const result = await client.query(
            `INSERT INTO spots
               ("contentId", title, addr1, "mapX", "mapY", firstimage,
                contenttypeid, areacode, sigungucode)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT ("contentId") DO NOTHING`,
            [
              item.contentid,
              item.title,
              item.addr1 ?? null,
              parseCoord(item.mapx),
              parseCoord(item.mapy),
              item.firstimage ?? null,
              item.contenttypeid ?? null,
              item.areacode ?? null,
              item.sigungucode ?? null,
            ],
          );
          if ((result.rowCount ?? 0) > 0) inserted++;
          else skipped++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      }

      console.log(` ${items.length}건 처리`);

      if (page < totalPages) await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`\n완료: 신규 ${inserted}건 삽입, ${skipped}건 중복 스킵`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('시딩 실패:', err);
  process.exit(1);
});
