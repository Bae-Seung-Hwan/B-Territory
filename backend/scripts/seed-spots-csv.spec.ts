import {
  parseCsv,
  parseCoord,
  normalizeSigunguCode,
  findDuplicateMissionIds,
} from './seed-spots-csv';

describe('seed-spots-csv', () => {
  describe('parseCsv', () => {
    it('쉼표로 구분된 기본 행을 파싱한다', () => {
      expect(parseCsv('a,b,c\n1,2,3')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    it('따옴표 안의 쉼표·줄바꿈·이스케이프된 따옴표를 그대로 보존한다', () => {
      const csv =
        'title,address\n"라 메르, 호텔","부산\n해운대구"\n"He said ""hi""",plain';
      expect(parseCsv(csv)).toEqual([
        ['title', 'address'],
        ['라 메르, 호텔', '부산\n해운대구'],
        ['He said "hi"', 'plain'],
      ]);
    });

    it('빈 입력은 빈 배열을 반환한다', () => {
      expect(parseCsv('')).toEqual([]);
    });
  });

  describe('parseCoord', () => {
    it('유효한 숫자 문자열을 숫자로 변환한다', () => {
      expect(parseCoord('129.0756')).toBe(129.0756);
    });

    it('빈 값/undefined/숫자가 아닌 값은 null을 반환한다', () => {
      expect(parseCoord(undefined)).toBeNull();
      expect(parseCoord('')).toBeNull();
      expect(parseCoord('not-a-number')).toBeNull();
    });
  });

  describe('normalizeSigunguCode', () => {
    it('이미 유효한 숫자 코드는 그대로 반환한다', () => {
      expect(normalizeSigunguCode('16', 'MISSION_0001')).toBe('16');
    });

    it('한글 구 이름을 KTO 표준 코드로 매핑한다', () => {
      expect(normalizeSigunguCode('해운대구', 'MISSION_0001')).toBe('16');
      expect(normalizeSigunguCode('영도구', 'MISSION_0002')).toBe('14');
    });

    it('빈 값은 시딩을 실패시킨다 (조용히 null로 넣지 않음)', () => {
      expect(() => normalizeSigunguCode('', 'MISSION_0003')).toThrow(
        /비어 있습니다/,
      );
      expect(() => normalizeSigunguCode('   ', 'MISSION_0003')).toThrow(
        /비어 있습니다/,
      );
    });

    it('매핑 불가한 값은 예외를 던진다', () => {
      expect(() => normalizeSigunguCode('서울강남구', 'MISSION_0004')).toThrow(
        /알 수 없는 sigungu_code/,
      );
    });
  });

  describe('findDuplicateMissionIds', () => {
    it('중복 없는 mission_id는 duplicateIds가 빈 배열이다', () => {
      const { duplicateIds, titleByMissionId } = findDuplicateMissionIds([
        { mission_id: 'MISSION_0001', title: 'A' } as never,
        { mission_id: 'MISSION_0002', title: 'B' } as never,
      ]);
      expect(duplicateIds).toEqual([]);
      expect(titleByMissionId.get('MISSION_0001')).toBe('A');
    });

    it('같은 mission_id가 두 번 나오면 두 title을 함께 보고한다', () => {
      const { duplicateIds } = findDuplicateMissionIds([
        { mission_id: 'MISSION_0001', title: '라메르호텔' } as never,
        { mission_id: 'MISSION_0001', title: '라메르호텔' } as never,
      ]);
      expect(duplicateIds).toEqual([
        'MISSION_0001 ("라메르호텔" / "라메르호텔")',
      ]);
    });

    it('mission_id가 빈 값인 행은 중복 검사에서 제외한다', () => {
      const { duplicateIds } = findDuplicateMissionIds([
        { mission_id: '', title: 'A' } as never,
        { mission_id: '  ', title: 'B' } as never,
      ]);
      expect(duplicateIds).toEqual([]);
    });
  });
});
