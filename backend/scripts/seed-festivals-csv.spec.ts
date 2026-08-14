import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseYmd,
  contentIdOf,
  normalizeSigunguCode,
  buildSeedRows,
  loadFestivalRows,
} from './seed-festivals-csv';

const HEADER =
  'source,source_id,title,address,place,map_x,map_y,image_url,start_date,end_date,usage_time,tel,description,homepage,sigungu_code';

/** CSV 한 행을 헤더 순서대로 만든다 (지정하지 않은 컬럼은 빈 문자열). */
function row(overrides: Record<string, string>): string {
  const cols = HEADER.split(',');
  return cols.map((c) => overrides[c] ?? '').join(',');
}

function build(rows: Record<string, string>[]) {
  const csv = [HEADER, ...rows.map(row)].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festivals-csv-'));
  const file = path.join(dir, 'festivals.csv');
  fs.writeFileSync(file, csv, 'utf8');
  try {
    return buildSeedRows(loadFestivalRows(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('seed-festivals-csv', () => {
  describe('parseYmd', () => {
    it("'YYYYMMDD'를 Postgres date 형식으로 변환한다", () => {
      expect(parseYmd('20260101')).toBe('2026-01-01');
    });

    it('형식이 아니거나 비어 있으면 null을 반환한다', () => {
      expect(parseYmd('')).toBeNull();
      expect(parseYmd(undefined)).toBeNull();
      expect(parseYmd('2026-01-01')).toBeNull();
      expect(parseYmd('2026. 1. 1.')).toBeNull();
      expect(parseYmd('202601')).toBeNull();
    });
  });

  describe('contentIdOf', () => {
    // kto_festival의 source_id는 TourAPI contentid 그 자체라, 접두사를 붙이면
    // 이후 동기화가 같은 축제를 새 행으로 중복 생성한다.
    it('kto_festival은 source_id를 접두사 없이 그대로 쓴다', () => {
      expect(
        contentIdOf({ source: 'kto_festival', source_id: '2786391' } as never),
      ).toBe('2786391');
    });

    it('다른 출처는 출처를 접두사로 붙여 ID 충돌을 막는다', () => {
      expect(
        contentIdOf({ source: 'busan_festival', source_id: '2368' } as never),
      ).toBe('busan_festival:2368');
    });
  });

  describe('normalizeSigunguCode', () => {
    it('유효한 숫자 코드는 그대로 통과시킨다', () => {
      expect(normalizeSigunguCode('12')).toBe('12');
    });

    it('한글 구 이름을 KTO 표준 코드로 변환한다', () => {
      expect(normalizeSigunguCode('수영구')).toBe('12');
      expect(normalizeSigunguCode('해운대구')).toBe('16');
    });

    // spots 시딩과 달리 예외를 던지지 않는다 — festivals.sigungucode는 nullable이고
    // DATA_README가 장소 불명확 1건을 의도적으로 미매핑으로 남겼다고 명시한다.
    it('빈 값이나 알 수 없는 값은 예외 대신 null을 반환한다', () => {
      expect(normalizeSigunguCode('')).toBeNull();
      expect(normalizeSigunguCode('   ')).toBeNull();
      expect(normalizeSigunguCode('강남구')).toBeNull();
    });
  });

  describe('buildSeedRows', () => {
    it('날짜가 온전한 행만 시딩 대상으로 삼는다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: '축제A',
          start_date: '20260101',
          end_date: '20261231',
          sigungu_code: '12',
        },
        {
          source: 'busan_festival',
          source_id: '2',
          title: '축제B',
          sigungu_code: '16',
        },
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].contentId).toBe('1');
      expect(result.rows[0].eventStartDate).toBe('2026-01-01');
      expect(result.rows[0].eventEndDate).toBe('2026-12-31');
    });

    // 왜 40건이 안 들어왔는지 매번 다시 조사하지 않도록 출처별로 집계해 보고한다.
    it('날짜 없는 행을 출처별로 집계한다', () => {
      const result = build([
        { source: 'busan_festival', source_id: '1', title: 'A' },
        { source: 'busan_festival', source_id: '2', title: 'B' },
        {
          source: 'kto_festival',
          source_id: '3',
          title: 'C',
          start_date: '20260101',
        },
      ]);

      expect(result.skippedNoDate).toEqual({
        busan_festival: 2,
        kto_festival: 1,
      });
      expect(result.rows).toHaveLength(0);
    });

    it('좌표를 숫자로 변환하고 빈 값은 null로 둔다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: 'A',
          start_date: '20260101',
          end_date: '20261231',
          map_x: '129.1185477876',
          map_y: '35.1538130576',
          sigungu_code: '12',
        },
        {
          source: 'kto_festival',
          source_id: '2',
          title: 'B',
          start_date: '20260101',
          end_date: '20261231',
          sigungu_code: '12',
        },
      ]);

      expect(result.rows[0].mapX).toBe(129.1185477876);
      expect(result.rows[0].mapY).toBe(35.1538130576);
      expect(result.rows[1].mapX).toBeNull();
      expect(result.rows[1].mapY).toBeNull();
    });

    it('contentId가 겹치는 행을 보고하고 뒤엣것을 넣지 않는다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: '원본',
          start_date: '20260101',
          end_date: '20261231',
        },
        {
          source: 'kto_festival',
          source_id: '1',
          title: '중복',
          start_date: '20260101',
          end_date: '20261231',
        },
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].title).toBe('원본');
      expect(result.duplicateContentIds).toHaveLength(1);
      expect(result.duplicateContentIds[0]).toContain('원본');
      expect(result.duplicateContentIds[0]).toContain('중복');
    });

    it('종료일이 시작일보다 앞선 원본 오류를 경고 목록에 담는다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: '날짜역전',
          start_date: '20251023',
          end_date: '20251006',
        },
      ]);

      expect(result.rows).toHaveLength(1); // 넣기는 하되
      expect(result.reversedDates).toHaveLength(1); // 경고로 남긴다
    });

    it('sigungu_code를 매핑하지 못한 행을 경고 목록에 담되 시딩은 계속한다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: '장소미정',
          start_date: '20260101',
          end_date: '20261231',
          sigungu_code: '',
        },
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].sigungucode).toBeNull();
      expect(result.unmappedSigungu).toHaveLength(1);
    });

    it('title이나 source_id가 없는 행은 스킵한다', () => {
      const result = build([
        {
          source: 'kto_festival',
          source_id: '1',
          title: '',
          start_date: '20260101',
          end_date: '20261231',
        },
        {
          source: 'kto_festival',
          source_id: '',
          title: 'B',
          start_date: '20260101',
          end_date: '20261231',
        },
      ]);

      expect(result.rows).toHaveLength(0);
      expect(result.skippedNoKey).toBe(2);
    });
  });

  describe('loadFestivalRows', () => {
    it('필수 헤더가 없으면 즉시 실패한다', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festivals-csv-'));
      const file = path.join(dir, 'bad.csv');
      fs.writeFileSync(file, 'source,title\nkto_festival,축제', 'utf8');
      try {
        expect(() => loadFestivalRows(file)).toThrow(/필수 컬럼이 없습니다/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('헤더만 있고 데이터가 없으면 실패한다', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festivals-csv-'));
      const file = path.join(dir, 'header-only.csv');
      fs.writeFileSync(file, HEADER, 'utf8');
      try {
        expect(() => loadFestivalRows(file)).toThrow(/데이터 행이 없습니다/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
