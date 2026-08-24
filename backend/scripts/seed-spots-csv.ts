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

const AREA_CODE = '6'; // 부산
const CSV_PATH = path.join(__dirname, '../../data/mission_places_final.csv');

// KTO 표준 부산(areaCode=6) 시군구 코드표 (가나다순 1~16).
// CSV의 sigungu_code는 소스에 따라 숫자 코드(kto_area_based)와 한글 구 이름
// (busan_attraction)이 혼재되어 있어(DATA_README "구 코드 또는 구 이름"),
// 구 단위 점령 집계(GROUP BY sigungucode)가 쪼개지지 않도록 코드로 정규화한다.
export const BUSAN_SIGUNGU_CODE_BY_NAME: Record<string, string> = {
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
export const VALID_SIGUNGU_CODES = new Set(
  Object.values(BUSAN_SIGUNGU_CODE_BY_NAME),
);
const BUSAN_SIGUNGU_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(BUSAN_SIGUNGU_CODE_BY_NAME).map(([name, code]) => [
    code,
    name,
  ]),
);

// 주소 문자열에서 부산 구/군 이름을 추출한다 (매핑 테이블에 있는 이름만 인식).
// normalizeSigunguCode()는 "매핑 불가/빈 값"만 막고 "값이 틀린" 경우(MISSION_0031:
// 주소는 수영구인데 코드는 16=해운대구)는 통과시키므로, 주소 기반으로 교차검증해
// 어긋나면 경고를 남긴다 — 다음 CSV 갱신에서 같은 원본 오류가 들어와도 자동으로 드러난다.
export function districtNameFromAddress(address: string): string | null {
  for (const name of Object.keys(BUSAN_SIGUNGU_CODE_BY_NAME)) {
    const idx = address.indexOf(name);
    if (idx === -1) continue;
    // 앞 글자가 한글 음절이면 더 긴 이름의 일부다(예: "강남구" 안의 "남구"). 이 경우는
    // 부산 구/군이 아니므로 건너뛴다 — 구 이름은 "시/도/공백" 뒤에 토큰으로 나온다.
    const prev = idx === 0 ? '' : address[idx - 1];
    if (/[가-힣]/.test(prev)) continue;
    return name;
  }
  return null;
}

// 알 수 없는 값이나 빈 값을 null로 조용히 넣으면 집계에서 해당 관광지가 증발하므로 시딩을 실패시킨다
export function normalizeSigunguCode(value: string, missionId: string): string {
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

// 시딩에 실제로 쓰는 필수 컬럼. 헤더가 바뀌거나(예: mission_id → missionId) 파일이 손상되면
// 모든 행이 조용히 빈 값으로 읽혀 전부 스킵되는데, 그 상태로 후처리(잔여 행 자동 삭제)까지
// 진행되면 위험하므로 로드 시점에 헤더를 검증해 즉시 실패시킨다.
const REQUIRED_HEADERS = [
  'mission_id',
  'title',
  'address',
  'map_x',
  'map_y',
  'image_url',
  'content_type_id',
  'sigungu_code',
  'description',
  'homepage',
] as const;

// data/mission_places_final.csv — 한국관광공사 + 부산시 API 3종을 합쳐
// 중복 제거·품질 검증까지 마친 최종 산출물 (data/DATA_README.md 참고)
export function parseCsv(text: string): string[][] {
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

export function loadMissionRows(filePath: string): MissionRow[] {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM 제거
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    throw new Error(`CSV가 비어 있습니다: ${filePath}`);
  }
  const header = rows[0];
  const missing = REQUIRED_HEADERS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `CSV 헤더에 필수 컬럼이 없습니다: ${missing.join(', ')} — ` +
        `헤더가 변경됐거나 파일이 손상됐을 수 있습니다 (실제 헤더: ${header.join(', ')})`,
    );
  }
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new Error(`CSV에 데이터 행이 없습니다 (헤더만 존재): ${filePath}`);
  }
  return dataRows.map((r) => {
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = r[idx] ?? '';
    });
    return record as unknown as MissionRow;
  });
}

export function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}

// mission_id는 PK 성격의 contentId로 그대로 들어가므로, CSV 갱신 과정에서 중복이
// 생기면 ON CONFLICT("contentId")가 서로 다른 두 장소를 한 행으로 조용히 뭉갠다.
export function findDuplicateMissionIds(missions: MissionRow[]): {
  titleByMissionId: Map<string, string>;
  duplicateIds: string[];
} {
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
  return { titleByMissionId, duplicateIds };
}

// --dry-run: DB에 아무것도 반영하지 않고(upsert는 ROLLBACK, 잔여 행은 실제 DELETE 대신
// 대상 미리보기) 이번 실행이 무엇을 할지만 보여준다. 처음 정리하는 dev/staging 환경에서
// 자동 삭제 대상을 미리 검토할 수 있도록 한다.
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // 실제 실행(require.main === module) 시점에만 검증한다 — 이 파일을 테스트에서
  // import만 할 때는(순수 함수 단위 테스트) .env가 없어도 막히지 않도록 한다.
  for (const key of REQUIRED_DB_VARS) {
    if (!process.env[key])
      throw new Error(
        `${key} 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.`,
      );
  }

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${CSV_PATH}`);
  }
  const missions = loadMissionRows(CSV_PATH);
  console.log(
    `CSV 로드: ${missions.length}건${DRY_RUN ? ' (--dry-run: DB 반영 없이 미리보기만)' : ''}`,
  );

  // 삽입 전에 전수 검증해 시딩 시점에 바로 실패시킨다. (빈 값은 삽입 루프에서 스킵)
  const { titleByMissionId, duplicateIds } = findDuplicateMissionIds(missions);
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
    const sigunguMismatches: string[] = [];

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

        const sigungucode = normalizeSigunguCode(
          m.sigungu_code ?? '',
          missionId,
        );
        const addrDistrict = districtNameFromAddress(m.address ?? '');
        const codeDistrict = BUSAN_SIGUNGU_NAME_BY_CODE[sigungucode];
        if (addrDistrict && codeDistrict && addrDistrict !== codeDistrict) {
          sigunguMismatches.push(
            `  - ${missionId} 주소상 "${addrDistrict}" ≠ sigungu_code ${sigungucode}("${codeDistrict}") (주소: ${m.address})`,
          );
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
            sigungucode,
            m.description || null,
            m.homepage || null,
          ],
        );
        if ((result.rowCount ?? 0) === 0) unchanged++;
        else if (result.rows[0].inserted) inserted++;
        else updated++;
      }
      // dry-run은 위 upsert 결과를 눈으로 확인만 하고 실제로는 반영하지 않는다.
      await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}완료: 신규 ${inserted}건, 갱신 ${updated}건, 변경 없음 ${unchanged}건, 스킵 ${skipped}건(mission_id/title 없음)`,
    );

    // 헤더 검증을 통과했는데도 한 건도 반영되지 않았다면(전 행 스킵) CSV 내용이 비정상이라는
    // 뜻이다. 이 상태로 파괴적인 후처리(잔여 행 자동 삭제)에 진입하면 정상 데이터가 없는데도
    // DB를 정리하게 되므로, 후처리 전에 실패시킨다 (exit 1). dry-run은 미리보기이므로 예외.
    if (
      !DRY_RUN &&
      missions.length > 0 &&
      inserted + updated + unchanged === 0
    ) {
      throw new Error(
        `CSV ${missions.length}건이 전부 스킵되어 시딩된 행이 없습니다 (mission_id/title 누락 등). ` +
          `CSV 형식을 확인하세요 — 잔여 행 정리를 건너뜁니다.`,
      );
    }

    // 주소↔sigungu_code 불일치(원본 데이터 오류)는 시딩을 막지는 않되 경고로 남긴다.
    if (sigunguMismatches.length > 0) {
      console.warn(
        `경고: 주소상 구/군과 sigungu_code가 어긋나는 행 ${sigunguMismatches.length}건 ` +
          `(원본 데이터 오류로 추정 — 해당 장소의 점령이 다른 구로 집계됩니다. 데이터팀 확인 요망):\n` +
          sigunguMismatches.join('\n'),
      );
    }

    // 삭제해도 안전한 잔여 행의 조건 — dry-run 미리보기와 실제 DELETE가 갈리지 않도록
    // 한 곳에서만 정의한다. 새로 spots를 참조하는 테이블이 생기면 여기에 추가해야 한다.
    const NO_USER_RECORDS = `
      NOT EXISTS (SELECT 1 FROM spot_claims sc WHERE sc."spotId" = s.id)
      AND NOT EXISTS (SELECT 1 FROM mission_photos mp WHERE mp."spotId" = s.id)
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r."spotId" = s.id)`;

    // 위 upsert는 이미 커밋(또는 dry-run 롤백)까지 끝난 상태라, 아래 후처리(잔여 행 정리·경고)가
    // 실패해도 시딩 자체가 실패한 것처럼 보이면 안 된다 — 별도로 잡아서 경고로만 남긴다.
    try {
      // 구 KTO 동기화(seed-spots.ts, 제거됨)가 넣어둔 행이 남아 있으면 같은 장소가
      // CSV 행과 중복 노출될 뿐 아니라, legacy sigungucode 포맷(예: "6-2")이 신규 코드(예:
      // "16")와 물리적으로 같은 구를 가리켜 구 점령 집계(aggregateDistricts GROUP BY
      // sigungucode)가 쪼개지는, 이 PR이 애초에 고치려던 버그가 재발할 수 있다.
      // 유저 기록이 없는 잔여 행은 삭제해도 잃을 게 없어 자동 삭제하고, 기록이 달린 행은
      // CASCADE 삭제로 그 기록이 조용히 사라질 수 있어 수동 정리를 유도한다.
      //
      // spot_claims뿐 아니라 mission_photos/reviews도 확인해야 한다 — 세 테이블 모두 spot FK가
      // CASCADE인데 점령 기록만 보고 지우면, "점령된 적은 없지만 사진·리뷰 미션 기록은 있는"
      // 스팟에서 증빙이 통째로 사라진다. 그때 score_events는 spotId가 SET NULL이라 원장 행은
      // 남으므로(원장은 append-only가 원칙), 지급 근거를 확인할 수 없는 점수만 남게 된다.
      // mission_photos는 imageUrl까지 함께 사라져 S3 객체가 영구 고아가 된다.
      if (DRY_RUN) {
        const preview = await client.query<{
          id: number;
          contentId: string;
          title: string;
        }>(
          `SELECT s.id, s."contentId", s.title FROM spots s
           WHERE s."contentId" NOT LIKE 'MISSION%'
             AND ${NO_USER_RECORDS}`,
        );
        if ((preview.rowCount ?? 0) > 0) {
          console.log(
            `[dry-run] 유저 기록(점령·사진·리뷰)이 없는 구 KTO 잔여 행 ${preview.rowCount}건이 삭제 대상입니다 (실제로 삭제하지 않음):`,
          );
          for (const row of preview.rows) {
            console.log(`  - ${row.contentId} ${row.title}`);
          }
        }
      } else {
        const deletedStale = await client.query<{
          contentId: string;
          title: string;
        }>(
          `DELETE FROM spots s
           WHERE s."contentId" NOT LIKE 'MISSION%'
             AND ${NO_USER_RECORDS}
           RETURNING s."contentId", s.title`,
        );
        if ((deletedStale.rowCount ?? 0) > 0) {
          // 무엇을 지웠는지 사후에 확인할 수 있도록 dry-run과 동일하게 목록을 남긴다.
          console.log(
            `구 KTO 시딩 잔여 행 중 유저 기록(점령·사진·리뷰)이 없는 ${deletedStale.rowCount}건을 자동 삭제했습니다:`,
          );
          for (const row of deletedStale.rows) {
            console.log(`  - ${row.contentId} ${row.title}`);
          }
        }
      }

      // dry-run은 삭제를 시도조차 하지 않으므로, 이 경고("자동 삭제하지 못함")는 실제
      // 삭제를 수행한 뒤(= 남은 건 정말 점령 기록 때문에 못 지운 것) 의미가 있다.
      if (!DRY_RUN) {
        const stale = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM spots WHERE "contentId" NOT LIKE 'MISSION%'`,
        );
        const staleCount = Number(stale.rows[0].count);
        if (staleCount > 0) {
          console.warn(
            `경고: 유저 기록이 있어 자동 삭제하지 못한 구 KTO 잔여 행 ${staleCount}건이 남아 있습니다. ` +
              `같은 장소가 중복 노출되는 것뿐 아니라, legacy sigungucode가 신규 코드와 물리적으로 같은 구를 ` +
              `가리켜 구 점령 집계(aggregateDistricts)가 쪼개지고 있을 수 있습니다. spot_claims/mission_photos/reviews를 ` +
              `이관/백업할 방법을 검토한 뒤 정리하세요 (세 테이블 모두 spot FK가 CASCADE라 spots 행을 지우면 ` +
              `점령 기록과 미션 증빙이 함께 삭제되고, mission_photos는 S3 객체까지 고아가 됩니다).`,
          );
        }
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
    } catch (postErr) {
      console.error(
        '경고: 시딩(upsert)은 이미 정상 반영됐지만, 잔여 행 정리/경고 단계에서 오류가 발생했습니다:',
        postErr,
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

// 테스트에서 순수 함수만 import할 때는 시딩이 자동 실행되지 않도록 가드한다.
if (require.main === module) {
  main().catch((err) => {
    console.error('시딩 실패:', err);
    process.exit(1);
  });
}
