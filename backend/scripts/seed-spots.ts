import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const SERVICE_KEY =
  '3a3a0f8a921262ce249d0d2ef3576a5a06cec8c95c45e0266609298199ccb24c';
const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const AREA_CODE = '6'; // 부산
const NUM_OF_ROWS = 100;

async function fetchPage(pageNo: number): Promise<{ items: any[]; total: number }> {
  const url =
    `${BASE_URL}/areaBasedList2` +
    `?serviceKey=${SERVICE_KEY}` +
    `&numOfRows=${NUM_OF_ROWS}` +
    `&pageNo=${pageNo}` +
    `&MobileOS=ETC` +
    `&MobileApp=BTerritorySeeder` +
    `&_type=json` +
    `&areaCode=${AREA_CODE}`;

  const res = await fetch(url);
  const data: any = await res.json();
  const body = data?.response?.body;

  const raw = body?.items?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return { items, total: Number(body?.totalCount ?? 0) };
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'b_territory',
  });

  await client.connect();
  console.log('DB 연결 성공');

  const { total } = await fetchPage(1);
  const totalPages = Math.ceil(total / NUM_OF_ROWS);
  console.log(`총 ${total}건 / ${totalPages}페이지`);

  let inserted = 0;
  let skipped = 0;

  for (let page = 1; page <= totalPages; page++) {
    process.stdout.write(`[${page}/${totalPages}] 요청 중...`);
    const { items } = await fetchPage(page);

    for (const item of items) {
      const result = await client.query(
        `INSERT INTO spots
           ("contentId", title, addr1, "mapX", "mapY", firstimage,
            contenttypeid, areacode, sigungucode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ("contentId") DO NOTHING`,
        [
          item.contentid,
          item.title ?? '',
          item.addr1 ?? null,
          item.mapx ? parseFloat(item.mapx) : null,
          item.mapy ? parseFloat(item.mapy) : null,
          item.firstimage ?? null,
          item.contenttypeid ?? null,
          item.areacode ?? null,
          item.sigungucode ?? null,
        ],
      );
      if (result.rowCount! > 0) inserted++;
      else skipped++;
    }

    console.log(` ${items.length}건 처리`);

    if (page < totalPages) await new Promise((r) => setTimeout(r, 300));
  }

  await client.end();
  console.log(`\n완료: 신규 ${inserted}건 삽입, ${skipped}건 중복 스킵`);
}

main().catch((err) => {
  console.error('시딩 실패:', err);
  process.exit(1);
});
