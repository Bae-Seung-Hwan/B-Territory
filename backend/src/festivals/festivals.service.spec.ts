import { Logger } from '@nestjs/common';
import { FestivalsService } from './festivals.service';

/**
 * syncFromApi 중 DB 없이 고정할 수 있는 부분만 검증한다 — 지역 필터 파라미터와 지역코드 매핑.
 *
 * KorService2가 신규 축제 레코드의 areacode/sigungucode를 빈 문자열로 내려주기 시작하면서
 * areaCode=6 필터가 아무것도 잡지 못했는데, HTTP 200 · resultCode 0000 · totalCount 0이라
 * 예외도 에러 로그도 없이 반년간 조용히 0건 동기화가 반복됐다. 같은 유형의 upstream 스키마
 * 변경을 다음에는 테스트와 경고 로그로 잡는다.
 *
 * upsert 동작(좌표 보존, 빈 문자열 정규화 등)은 festivals.e2e-spec이 담당한다.
 */

/** UPSERT_COLUMNS 순서에 맞춘 파라미터 인덱스. */
const P_AREACODE = 9;
const P_SIGUNGUCODE = 10;

const BUSAN_ITEM = {
  contentid: '1275743',
  title: '금정산성축제',
  addr1: '부산광역시 금정구 산성로 501-2',
  mapx: '129.0881500000',
  mapy: '35.2380900000',
  firstimage: 'https://example.test/1275743.jpg',
  tel: '051-715-6884',
  eventstartdate: '20261016',
  eventenddate: '20261018',
  // 신규 레코드의 실제 형태 — 지역 정보가 lDong* 에만 있다.
  areacode: '',
  sigungucode: '',
  lDongRegnCd: '26',
  lDongSignguCd: '410',
};

function apiResponse(items: unknown[], totalCount: number) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () =>
      Promise.resolve({
        response: {
          header: { resultCode: '0000', resultMsg: 'OK' },
          // 응답이 비면 items는 객체가 아니라 빈 문자열로 온다.
          body: { items: items.length ? { item: items } : '', totalCount },
        },
      }),
  } as unknown as Response;
}

/** query.mock.calls는 any라 인덱싱 전에 실제 시그니처로 좁힌다. */
function upsertParams(query: jest.Mock, call = 0): unknown[] {
  const calls = query.mock.calls as [string, unknown[]][];
  return calls[call][1];
}

function makeService(items: unknown[], totalCount = items.length) {
  const query = jest.fn().mockResolvedValue(undefined);
  const execute = jest.fn().mockResolvedValue({ affected: 0 });
  const repo = {
    query,
    createQueryBuilder: () => ({
      delete: () => ({ where: () => ({ andWhere: () => ({ execute }) }) }),
    }),
  };
  const config = { get: jest.fn().mockReturnValue('test-service-key') };
  const service = new FestivalsService(repo as never, config as never);
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(apiResponse(items, totalCount));
  return { service, query, fetchMock };
}

afterEach(() => jest.restoreAllMocks());

describe('FestivalsService.syncFromApi', () => {
  it('지역 필터로 법정동 시도코드를 보낸다 (areaCode는 더 이상 쓰지 않는다)', async () => {
    const { service, fetchMock } = makeService([BUSAN_ITEM]);

    await service.syncFromApi();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('lDongRegnCd=26');
    // areaCode는 신규 레코드에서 빈 값이라 붙이는 순간 0건이 된다.
    expect(url).not.toContain('areaCode=');
  });

  it('빈 sigungucode를 법정동 코드가 아니라 KTO 코드로 환산해 저장한다', async () => {
    const { service, query } = makeService([BUSAN_ITEM]);

    const result = await service.syncFromApi();

    expect(result.synced).toBe(1);
    const params = upsertParams(query);
    // 시더(seed-festivals-csv)가 쓰는 체계와 같아야 한다. 법정동 코드 '410'을 그대로
    // 넣으면 upsert COALESCE가 시더의 금정구='2'를 덮어써 구 단위 노출이 깨진다.
    expect(params[P_AREACODE]).toBe('6');
    expect(params[P_SIGUNGUCODE]).toBe('2');
  });

  it('환산표에 없는 법정동 코드는 섞어 넣지 않고 비워 둔다', async () => {
    const { service, query } = makeService([
      { ...BUSAN_ITEM, lDongSignguCd: '999' },
    ]);

    await service.syncFromApi();

    expect(upsertParams(query)[P_SIGUNGUCODE]).toBeNull();
  });

  it('API가 sigungucode를 주면 그 값이 환산값보다 우선한다', async () => {
    const { service, query } = makeService([
      { ...BUSAN_ITEM, sigungucode: '9', lDongSignguCd: '410' },
    ]);

    await service.syncFromApi();

    expect(upsertParams(query)[P_SIGUNGUCODE]).toBe('9');
  });

  it('지역 필터가 무시돼 전국 데이터가 와도 부산 외 축제는 걸러낸다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, query } = makeService([
      BUSAN_ITEM,
      {
        ...BUSAN_ITEM,
        contentid: '9999999',
        title: '서울세계불꽃축제',
        addr1: '서울특별시 영등포구 여의동로 330',
        lDongRegnCd: '11',
        lDongSignguCd: '560',
      },
    ]);

    const result = await service.syncFromApi();

    // total > 0이라 0건 경고에는 걸리지 않는 실패 방향이다.
    expect(result.synced).toBe(1);
    expect(upsertParams(query)[0]).toBe(BUSAN_ITEM.contentid);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('부산이 아닌'));
  });

  it('지역 근거가 없는 행은 버리지 않되, 부산 구로 라벨링하지도 않는다', async () => {
    const { service, query } = makeService([
      { ...BUSAN_ITEM, addr1: '', lDongRegnCd: '' },
    ]);

    // 필드 누락만으로 멀쩡한 축제를 잃으면 안 된다.
    expect((await service.syncFromApi()).synced).toBe(1);
    // 다만 lDongSignguCd는 시도코드가 빠진 3자리라 전국에서 유일하지 않다('410'은 부산
    // 금정구지만 다른 시도의 구 접미 코드일 수도 있다). 부산이라는 근거가 없는 행에까지
    // 환산표를 적용하면 비-부산 축제가 그럴듯한 부산 구 코드를 달고 저장된다.
    expect(upsertParams(query)[P_SIGUNGUCODE]).toBeNull();
  });

  /**
   * 같은 응답의 totalCount가 이미 number|string으로 오는 데서 보듯 upstream은 필드 타입을
   * 일관되게 주지 않는다. 코드 필드가 숫자로 오면 .trim()이 TypeError를 던지는데, syncFromApi
   * 루프에는 try/catch가 없어 배치 전체가 죽는다 — 조용한 0건을 조용한 크래시로 바꿀 뿐이다.
   */
  it('코드 필드가 문자열이 아니라 숫자로 와도 죽지 않고 그대로 처리한다', async () => {
    const { service, query } = makeService([
      {
        ...BUSAN_ITEM,
        contentid: 1275743,
        lDongRegnCd: 26,
        lDongSignguCd: 410,
      },
    ]);

    const result = await service.syncFromApi();

    expect(result.synced).toBe(1);
    const params = upsertParams(query);
    expect(params[0]).toBe('1275743');
    // 숫자 26도 부산으로 인식돼야 한다 — 아니면 전량이 "부산 아님"으로 버려진다.
    expect(params[P_SIGUNGUCODE]).toBe('2');
  });

  it('원본 필드가 예상 밖 타입이면 그 행만 건너뛴다', async () => {
    const { service, query } = makeService([
      // title이 객체로 오면 문자열화해도 '[object Object]'가 DB까지 흘러간다.
      { ...BUSAN_ITEM, contentid: '9999999', title: { text: '축제' } },
      BUSAN_ITEM,
    ]);

    const result = await service.syncFromApi();

    expect(result.synced).toBe(1);
    expect(upsertParams(query)[0]).toBe(BUSAN_ITEM.contentid);
  });

  it('0건 응답은 정상 종료가 아니라 경고로 남긴다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, query } = makeService([], 0);

    const result = await service.syncFromApi();

    expect(result).toEqual({ synced: 0, deleted: 0 });
    // 응답이 비면 upsert도 정리도 하지 않는다 — 기존 데이터를 지우지 않기 위함.
    expect(query).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('0건 반환'));
  });
});
