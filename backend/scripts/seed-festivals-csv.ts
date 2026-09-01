import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  parseCsv,
  parseCoord,
  BUSAN_SIGUNGU_CODE_BY_NAME,
  VALID_SIGUNGU_CODES,
} from './seed-spots-csv';
import { kstDateString } from '../src/common/utils/kst.util';

dotenv.config({ path: path.join(__dirname, '../.env') });

const REQUIRED_DB_VARS = [
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

const AREA_CODE = '6'; // 부산
const CSV_PATH = path.join(__dirname, '../../data/festivals.csv');

// data/festivals.csv — TourAPI(kto_festival), 부산시 API(busan_festival), 구·군별
// 문화축제 CSV를 합쳐 날짜·sigungu_code를 보강한 최종 시딩용 파일
// (data/DATA_README.md 참고).
//
// 이 스크립트는 초기 시딩만 담당하고, 이후 최신화는 FestivalsService.syncFromApi()의
// TourAPI 동기화가 이어받는다(DATA_README "축제 데이터는 초기 시딩용으로 사용하고,
// 이후 KTO searchFestival2 API 동기화로 전환할 수 있습니다"). spots가 PR #16에서 밟은
// 것과 같은 경로다.
//
// 삭제는 일절 하지 않는다 — 테이블 정리는 syncFromApi()가 "이미 종료됐고 API가 더 이상
// 주지 않는 축제"만 지우는 방식으로 소유한다. 시딩이 별도로 지우면 두 주체가 같은
// 테이블을 서로 다른 기준으로 정리하게 된다.
const REQUIRED_HEADERS = [
  'source',
  'source_id',
  'title',
  'address',
  'map_x',
  'map_y',
  'image_url',
  'start_date',
  'end_date',
  'tel',
  'sigungu_code',
] as const;

interface FestivalCsvRow {
  source: string;
  source_id: string;
  title: string;
  address: string;
  place: string;
  map_x: string;
  map_y: string;
  image_url: string;
  start_date: string;
  end_date: string;
  usage_time: string;
  tel: string;
  description: string;
  homepage: string;
  sigungu_code: string;
}

export function loadFestivalRows(filePath: string): FestivalCsvRow[] {
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
    return record as unknown as FestivalCsvRow;
  });
}

/**
 * CSV의 'YYYYMMDD'를 Postgres date 컬럼용 'YYYY-MM-DD'로 변환.
 * FestivalsService의 parseYmd와 같은 규칙을 쓴다 — 두 경로가 같은 테이블에 쓰므로
 * 날짜 형식이 어긋나면 진행 상태 판정이 갈린다.
 *
 * 형식이 아니면 null. eventStartDate/eventEndDate는 NOT NULL이고 진행 상태 판정의
 * 유일한 근거라, 날짜가 없는 행은 넣을 수 없다(호출부에서 스킵).
 */
export function parseYmd(value?: string): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/**
 * CSV 행의 contentId — festivals.contentId는 unique이고 TourAPI 동기화의 upsert 키다.
 *
 * kto_festival의 source_id는 TourAPI contentid 그 자체라 접두사 없이 그대로 쓴다.
 * 그래야 이후 syncFromApi()가 같은 축제를 새 행으로 중복 생성하지 않고 이 행을 갱신한다.
 * 다른 출처(busan_festival)는 ID 체계가 달라 TourAPI contentid와 우연히 충돌할 수 있어
 * 출처를 접두사로 붙여 네임스페이스를 분리한다.
 */
export function contentIdOf(row: FestivalCsvRow): string {
  const id = row.source_id?.trim() ?? '';
  // 접두사도 반드시 트림된 값으로 만든다. 비교만 트림하면 " busan_festival"이
  // " busan_festival:2368"이 되어, CSV 정리 후 재실행 시 upsert 키가 달라지고
  // 같은 축제가 중복 행으로 들어간다.
  const source = row.source?.trim() ?? '';
  return source === 'kto_festival' ? id : `${source}:${id}`;
}

/**
 * sigungu_code를 KTO 표준 부산 구 코드로 정규화한다.
 * CSV는 소스에 따라 숫자 코드와 한글 구 이름이 혼재한다(DATA_README 참고).
 *
 * spots 시딩과 달리 매핑 실패를 예외로 올리지 않고 null을 반환한다 —
 * festivals.sigungucode는 nullable이고, DATA_README도 "장소가 불명확한 축제"
 * 1건을 의도적으로 미매핑으로 남겼다고 명시한다. 대신 호출부에서 경고로 집계한다.
 */
export function normalizeSigunguCode(value: string): string | null {
  const v = value?.trim() ?? '';
  if (!v) return null;
  if (VALID_SIGUNGU_CODES.has(v)) return v;
  return BUSAN_SIGUNGU_CODE_BY_NAME[v] ?? null;
}

/** 시딩 대상 한 건. 누락 필드는 명시적 null(아래 upsert의 COALESCE 참고). */
export interface SeedRow {
  contentId: string;
  title: string;
  addr1: string | null;
  mapX: number | null;
  mapY: number | null;
  firstimage: string | null;
  tel: string | null;
  eventStartDate: string;
  eventEndDate: string;
  areacode: string;
  sigungucode: string | null;
}

export interface BuildResult {
  rows: SeedRow[];
  /** 날짜가 없거나 형식이 아니라 스킵된 행 (출처별 집계) */
  skippedNoDate: Record<string, number>;
  /** 제목/ID가 없어 스킵된 행 */
  skippedNoKey: number;
  /** sigungu_code를 매핑하지 못한 행 (경고용) */
  unmappedSigungu: string[];
  /** 종료일이 시작일보다 앞선 행 (원본 오류 경고용) */
  reversedDates: string[];
  /** CSV 안에서 contentId가 겹치는 행 */
  duplicateContentIds: string[];
}

export function buildSeedRows(csvRows: FestivalCsvRow[]): BuildResult {
  const rows: SeedRow[] = [];
  const skippedNoDate: Record<string, number> = {};
  const unmappedSigungu: string[] = [];
  const reversedDates: string[] = [];
  const duplicateContentIds: string[] = [];
  const titleByContentId = new Map<string, string>();
  let skippedNoKey = 0;

  for (const r of csvRows) {
    const title = r.title?.trim() ?? '';
    const contentId = contentIdOf(r);
    if (!title || !r.source_id?.trim()) {
      skippedNoKey++;
      continue;
    }

    // 날짜가 없으면 진행 상태를 판정할 수 없고 컬럼도 NOT NULL이라 넣을 수 없다.
    // busan_festival 행은 원본 날짜가 자유 서식이라 CSV 작성 단계에서 비워진 상태다.
    const eventStartDate = parseYmd(r.start_date);
    const eventEndDate = parseYmd(r.end_date);
    if (!eventStartDate || !eventEndDate) {
      const source = r.source?.trim() || '(출처 없음)';
      skippedNoDate[source] = (skippedNoDate[source] ?? 0) + 1;
      continue;
    }

    const existingTitle = titleByContentId.get(contentId);
    if (existingTitle !== undefined) {
      duplicateContentIds.push(
        `${contentId} ("${existingTitle}" / "${title}")`,
      );
      continue;
    }
    titleByContentId.set(contentId, title);

    if (eventEndDate < eventStartDate) {
      reversedDates.push(
        `  - ${contentId} "${title}" ${eventStartDate} ~ ${eventEndDate}`,
      );
    }

    const sigungucode = normalizeSigunguCode(r.sigungu_code ?? '');
    if (!sigungucode) {
      unmappedSigungu.push(
        `  - ${contentId} "${title}" sigungu_code="${r.sigungu_code ?? ''}"`,
      );
    }

    rows.push({
      contentId,
      title,
      addr1: r.address?.trim() || null,
      mapX: parseCoord(r.map_x),
      mapY: parseCoord(r.map_y),
      firstimage: r.image_url?.trim() || null,
      tel: r.tel?.trim() || null,
      eventStartDate,
      eventEndDate,
      areacode: AREA_CODE,
      sigungucode,
    });
  }

  return {
    rows,
    skippedNoDate,
    skippedNoKey,
    unmappedSigungu,
    reversedDates,
    duplicateContentIds,
  };
}

// --dry-run: DB에 아무것도 반영하지 않고(ROLLBACK) 무엇이 들어갈지만 보여준다.
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // 실제 실행 시점에만 검증한다 — 순수 함수 단위 테스트에서 import만 할 때는 .env가 없어도 된다.
  for (const key of REQUIRED_DB_VARS) {
    if (!process.env[key])
      throw new Error(
        `${key} 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.`,
      );
  }

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${CSV_PATH}`);
  }

  const csvRows = loadFestivalRows(CSV_PATH);
  const built = buildSeedRows(csvRows);
  console.log(
    `CSV 로드: ${csvRows.length}건 → 시딩 대상 ${built.rows.length}건` +
      `${DRY_RUN ? ' (--dry-run: DB 반영 없이 미리보기만)' : ''}`,
  );

  if (built.duplicateContentIds.length > 0) {
    throw new Error(
      `CSV에 contentId가 겹치는 행 ${built.duplicateContentIds.length}건이 있습니다 — ` +
        `서로 다른 축제가 한 행으로 병합되므로 CSV를 먼저 보정하세요:\n` +
        built.duplicateContentIds.map((d) => `  - ${d}`).join('\n'),
    );
  }

  // 날짜 없는 행은 시딩할 수 없다. 최종 festivals.csv는 날짜 보정/제외 처리를 거친
  // 파일이므로 이 경고가 뜨면 데이터 회귀로 보고 CSV를 먼저 확인한다.
  const noDateTotal = Object.values(built.skippedNoDate).reduce(
    (a, b) => a + b,
    0,
  );
  if (noDateTotal > 0) {
    const breakdown = Object.entries(built.skippedNoDate)
      .map(([source, count]) => `${source} ${count}건`)
      .join(', ');
    console.warn(
      `날짜(start_date/end_date)가 없어 스킵한 행 ${noDateTotal}건: ${breakdown}\n` +
        `  eventStartDate/eventEndDate는 NOT NULL이며 진행 상태 판정의 유일한 근거라 날짜 없는 행은 넣을 수 없습니다.\n` +
        `  날짜 미확정 행은 data/festivals_removed_missing_dates.csv로 분리되어야 합니다.`,
    );
  }
  if (built.skippedNoKey > 0) {
    console.warn(`title/source_id가 없어 스킵한 행 ${built.skippedNoKey}건`);
  }

  if (built.rows.length === 0) {
    throw new Error(
      `시딩할 행이 한 건도 없습니다 (CSV ${csvRows.length}건 전부 스킵). CSV 형식을 확인하세요.`,
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
    const syncedAt = new Date();

    await client.query('BEGIN');
    try {
      for (const row of built.rows) {
        // COALESCE(EXCLUDED, 기존)로 갱신한다 — TourAPI 동기화(upsertBatch)와 같은 규칙이다.
        // CSV에 빈 값이 들어와도 이미 채워진 좌표·이미지를 null로 덮어쓰지 않는다.
        const result = await client.query<{ inserted: boolean }>(
          `INSERT INTO festivals
             ("contentId", title, addr1, "mapX", "mapY", firstimage, tel,
              "eventStartDate", "eventEndDate", areacode, sigungucode, "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT ("contentId") DO UPDATE SET
             title = COALESCE(EXCLUDED.title, festivals.title),
             addr1 = COALESCE(EXCLUDED.addr1, festivals.addr1),
             "mapX" = COALESCE(EXCLUDED."mapX", festivals."mapX"),
             "mapY" = COALESCE(EXCLUDED."mapY", festivals."mapY"),
             firstimage = COALESCE(EXCLUDED.firstimage, festivals.firstimage),
             tel = COALESCE(EXCLUDED.tel, festivals.tel),
             "eventStartDate" = COALESCE(EXCLUDED."eventStartDate", festivals."eventStartDate"),
             "eventEndDate" = COALESCE(EXCLUDED."eventEndDate", festivals."eventEndDate"),
             areacode = COALESCE(EXCLUDED.areacode, festivals.areacode),
             sigungucode = COALESCE(EXCLUDED.sigungucode, festivals.sigungucode),
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING (xmax = 0) AS inserted`,
          [
            row.contentId,
            row.title,
            row.addr1,
            row.mapX,
            row.mapY,
            row.firstimage,
            row.tel,
            row.eventStartDate,
            row.eventEndDate,
            row.areacode,
            row.sigungucode,
            syncedAt,
          ],
        );
        if (result.rows[0]?.inserted) inserted++;
        else updated++;
      }
      await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}완료: 신규 ${inserted}건, 갱신 ${updated}건`,
    );

    if (built.unmappedSigungu.length > 0) {
      console.warn(
        `경고: sigungu_code를 매핑하지 못한 행 ${built.unmappedSigungu.length}건 — 구 단위 노출에서 빠집니다:\n` +
          built.unmappedSigungu.join('\n'),
      );
    }
    if (built.reversedDates.length > 0) {
      console.warn(
        `경고: 종료일이 시작일보다 앞선 행 ${built.reversedDates.length}건 (원본 데이터 오류 추정) — 조회에서 진행중/예정 어디에도 잡히지 않습니다:\n` +
          built.reversedDates.join('\n'),
      );
    }

    // 시딩 직후 실제로 몇 건이 노출되는지 알려준다. TourAPI에 최신 축제가 없어 목록이
    // 비어 보이는 상황(PR #32 논의)에서 "시딩은 됐는데 왜 안 보이지"를 바로 구분할 수 있다.
    // 기준일은 CURRENT_DATE(서버 타임존)가 아니라 KST로 잡는다 — 조회 API(findAll)가
    // kstDateString()을 쓰므로, 여기서 서버 타임존을 쓰면 집계가 하루 어긋날 수 있다.
    const visible = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM festivals WHERE "eventEndDate" >= $1`,
      [kstDateString()],
    );
    console.log(
      `현재 조회에 잡히는(종료되지 않은) 축제: ${visible.rows[0].count}건`,
    );
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
