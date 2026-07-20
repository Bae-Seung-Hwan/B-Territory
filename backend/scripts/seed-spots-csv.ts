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

// KTO 표준 부산(areaCode=6) 시군구 코드표 (가나다순 1~16).
// CSV의 sigungu_code는 소스에 따라 숫자 코드(kto_area_based)와 한글 구 이름
// (busan_attraction)이 혼재되어 있어(DATA_README "구 코드 또는 구 이름"),
// 구 단위 점령 집계(GROUP BY sigungucode)가 쪼개지지 않도록 코드로 정규화한다.
const BUSAN_SIGUNGU_CODE_BY_NAME: Record<string, string> = {
  강서구: '1',
  금정구: '2',
  기장군: '3',
  남구: '4',
  동구: '5',
  동래구: '6',
  부산진구: '7',
  북구: '8',
  사상구: '9',
  사하구: '10',
  서구: '11',
  수영구: '12',
  연제구: '13',
  영도구: '14',
  중구: '15',
  해운대구: '16',
};
const VALID_SIGUNGU_CODES = new Set(Object.values(BUSAN_SIGUNGU_CODE_BY_NAME));

// 알 수 없는 값이나 빈 값을 null로 조용히 넣으면 집계에서 해당 관광지가 증발하므로 시딩을 실패시킨다
function normalizeSigunguCode(value: string, missionId: string): string {
  const v = value.trim();
  if (!v) {
    throw new Error(
      `sigungu_code가 비어 있습니다 (mission_id=${missionId}) — 구 집계에서 누락되므로 CSV를 보정하세요`,
    );
  }
  if (VALID_SIGUNGU_CODES.has(v)) return v;
  const mapped = BUSAN_SIGUNGU_CODE_BY_NAME[v];
  if (mapped) return mapped;
  throw new Error(
    `알 수 없는 sigungu_code "${value}" (mission_id=${missionId}) — 부산 시군구 매핑 테이블 갱신 필요`,
  );
}

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

  // mission_id는 PK 성격의 contentId로 그대로 들어가므로, CSV 갱신 과정에서 중복이
  // 생기면 ON CONFLICT("contentId")가 서로 다른 두 장소를 한 행으로 조용히 뭉갠다.
  // 삽입 전에 전수 검증해 시딩 시점에 바로 실패시킨다. (빈 값은 삽입 루프에서 스킵)
  const titleByMissionId = new Map<string, string>();
  const duplicateIds: string[] = [];
  for (const m of missions) {
    const id = m.mission_id?.trim();
    if (!id) continue;
    const existingTitle = titleByMissionId.get(id);
    if (existingTitle !== undefined) {
      duplicateIds.push(`${id} ("${existingTitle}" / "${m.title}")`);
    } else {
      titleByMissionId.set(id, m.title);
    }
  }
  if (duplicateIds.length > 0) {
    throw new Error(
      `CSV에 중복된 mission_id ${duplicateIds.length}건이 있습니다 — 서로 다른 장소가 한 행으로 병합되므로 CSV를 먼저 보정하세요:\n` +
        duplicateIds.map((d) => `  - ${d}`).join('\n'),
    );
  }

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
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    await client.query('BEGIN');
    try {
      for (const m of missions) {
        const missionId = m.mission_id?.trim();
        if (!missionId) {
          console.warn(`mission_id 없음, 스킵: title=${m.title}`);
          skipped++;
          continue;
        }
        if (!m.title?.trim()) {
          console.warn(`title 없음, 스킵: mission_id=${missionId}`);
          skipped++;
          continue;
        }

        // upsert: 데이터팀이 CSV를 보정하면 재실행만으로 기존 행에도 반영되도록 한다.
        // WHERE ... IS DISTINCT FROM 으로 실제 변경이 있는 행만 갱신하고,
        // RETURNING (xmax = 0)으로 신규 삽입/갱신을 구분해 집계한다.
        const result = await client.query<{ inserted: boolean }>(
          `INSERT INTO spots
             ("contentId", title, addr1, "mapX", "mapY", firstimage,
              contenttypeid, areacode, sigungucode, overview, homepage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT ("contentId") DO UPDATE SET
             title = EXCLUDED.title,
             addr1 = EXCLUDED.addr1,
             "mapX" = EXCLUDED."mapX",
             "mapY" = EXCLUDED."mapY",
             firstimage = EXCLUDED.firstimage,
             contenttypeid = EXCLUDED.contenttypeid,
             areacode = EXCLUDED.areacode,
             sigungucode = EXCLUDED.sigungucode,
             overview = EXCLUDED.overview,
             homepage = EXCLUDED.homepage
           WHERE (spots.title, spots.addr1, spots."mapX", spots."mapY",
                  spots.firstimage, spots.contenttypeid, spots.areacode,
                  spots.sigungucode, spots.overview, spots.homepage)
                 IS DISTINCT FROM
                 (EXCLUDED.title, EXCLUDED.addr1, EXCLUDED."mapX", EXCLUDED."mapY",
                  EXCLUDED.firstimage, EXCLUDED.contenttypeid, EXCLUDED.areacode,
                  EXCLUDED.sigungucode, EXCLUDED.overview, EXCLUDED.homepage)
           RETURNING (xmax = 0) AS inserted`,
          [
            missionId,
            m.title,
            m.address || null,
            parseCoord(m.map_x),
            parseCoord(m.map_y),
            m.image_url || null,
            m.content_type_id || null,
            AREA_CODE,
            normalizeSigunguCode(m.sigungu_code ?? '', missionId),
            m.description || null,
            m.homepage || null,
          ],
        );
        if ((result.rowCount ?? 0) === 0) unchanged++;
        else if (result.rows[0].inserted) inserted++;
        else updated++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    console.log(
      `완료: 신규 ${inserted}건, 갱신 ${updated}건, 변경 없음 ${unchanged}건, 스킵 ${skipped}건(mission_id/title 없음)`,
    );

    // 구 KTO 동기화(seed-spots.ts, 제거됨)가 넣어둔 행이 남아 있으면 같은 장소가
    // CSV 행과 중복 노출된다. FK(spot_claims) 우려로 자동 삭제하지 않고 경고만 남긴다.
    const stale = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM spots WHERE "contentId" NOT LIKE 'MISSION%'`,
    );
    const staleCount = Number(stale.rows[0].count);
    if (staleCount > 0) {
      console.warn(
        `경고: CSV 출처가 아닌 기존 행 ${staleCount}건이 남아 있습니다 (구 KTO 시딩 잔여 데이터 추정). ` +
          `같은 장소가 중복 노출될 수 있으니 점령 데이터(spot_claims) 확인 후 정리하세요.`,
      );
    }

    // upsert만 하므로 CSV에서 빠진 MISSION 행은 자동 삭제되지 않는다.
    // 데이터팀이 폐업·오류로 제거한 장소가 계속 노출/점령 대상이 되지 않도록 목록을 경고로 남긴다.
    const removedFromCsv = await client.query<{
      contentId: string;
      title: string;
    }>(
      `SELECT "contentId", title FROM spots
       WHERE "contentId" LIKE 'MISSION%' AND NOT ("contentId" = ANY($1))
       ORDER BY "contentId"`,
      [[...titleByMissionId.keys()]],
    );
    if ((removedFromCsv.rowCount ?? 0) > 0) {
      console.warn(
        `경고: 현재 CSV에 없는 MISSION 행 ${removedFromCsv.rowCount}건이 DB에 남아 있습니다 ` +
          `(CSV에서 제거된 장소로 추정). 점령 데이터(spot_claims) 확인 후 정리하세요.`,
      );
      for (const row of removedFromCsv.rows) {
        console.warn(`  - ${row.contentId} ${row.title}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('시딩 실패:', err);
  process.exit(1);
});
