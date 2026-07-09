import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const REQUIRED_DB_VARS = [
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
] as const;
for (const key of REQUIRED_DB_VARS) {
  if (!process.env[key])
    throw new Error(
      `${key} 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.`,
    );
}

const AREA_CODE = '6'; // 부산
const CSV_PATH = path.join(__dirname, '../../data/mission_places_final.csv');

interface MissionRow {
  mission_id: string;
  title: string;
  address: string;
  map_x: string;
  map_y: string;
  image_url: string;
  content_type_id: string;
  sigungu_code: string;
  description: string;
  homepage: string;
}

// data/mission_places_final.csv — 한국관광공사 + 부산시 API 3종을 합쳐
// 중복 제거·품질 검증까지 마친 최종 산출물 (data/DATA_README.md 참고)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function loadMissionRows(filePath: string): MissionRow[] {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM 제거
  const rows = parseCsv(raw);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = r[idx] ?? '';
    });
    return record as unknown as MissionRow;
  });
}

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${CSV_PATH}`);
  }
  const missions = loadMissionRows(CSV_PATH);
  console.log(`CSV 로드: ${missions.length}건`);

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
    let inserted = 0;
    let skipped = 0;

    await client.query('BEGIN');
    try {
      for (const m of missions) {
        if (!m.title?.trim()) {
          console.warn(`title 없음, 스킵: mission_id=${m.mission_id}`);
          skipped++;
          continue;
        }

        const result = await client.query(
          `INSERT INTO spots
             ("contentId", title, addr1, "mapX", "mapY", firstimage,
              contenttypeid, areacode, sigungucode, overview, homepage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT ("contentId") DO NOTHING`,
          [
            m.mission_id,
            m.title,
            m.address || null,
            parseCoord(m.map_x),
            parseCoord(m.map_y),
            m.image_url || null,
            m.content_type_id || null,
            AREA_CODE,
            m.sigungu_code || null,
            m.description || null,
            m.homepage || null,
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

    console.log(
      `완료: 신규 ${inserted}건 삽입, ${skipped}건 스킵(중복/title 없음)`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('시딩 실패:', err);
  process.exit(1);
});
