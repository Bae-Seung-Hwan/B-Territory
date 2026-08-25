import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Festival } from './entities/festival.entity';
import { FestivalStatus } from './dto/festival-query.dto';
import { kstDateString, kstYyyymmdd } from '../common/utils/kst.util';
import {
  ktoSigunguFromAddress,
  VALID_SIGUNGU_CODES,
} from '../common/geo/busan-district.util';

/**
 * TourAPI 원본 필드. **문자열로 온다는 보장이 없다** — 같은 응답의 totalCount가 이미
 * number|string으로 오는 데서 보듯 upstream이 타입을 일관되게 주지 않는다. 숫자로 온 필드에
 * .trim()을 부르면 TypeError가 나고, syncFromApi 루프는 try/catch가 없어 배치 전체가 죽는다.
 * 컴파일러가 그 가정을 못 하도록 넓게 선언하고, 읽을 때 nullIfBlank로 정규화한다.
 */
type ApiValue = string | number | null | undefined;

interface FestivalItem {
  contentid?: ApiValue;
  title?: ApiValue;
  addr1?: ApiValue;
  mapx?: ApiValue;
  mapy?: ApiValue;
  firstimage?: ApiValue;
  tel?: ApiValue;
  eventstartdate?: ApiValue; // 'YYYYMMDD'
  eventenddate?: ApiValue; // 'YYYYMMDD'
  areacode?: ApiValue;
  sigungucode?: ApiValue;
  // KorService2가 새로 내려주는 법정동 코드. 신규 레코드는 areacode/sigungucode가 빈 문자열로
  // 오고 지역 정보가 이 필드에만 담긴다. lDongSignguCd는 3자리('350')로, 시도코드를 붙인
  // 5자리('26350')가 아니다 — 5자리로 조회하면 0건이 나온다.
  lDongRegnCd?: ApiValue;
  lDongSignguCd?: ApiValue;
}

interface FestivalApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: { item: FestivalItem | FestivalItem[] } | '';
      totalCount: number | string;
    };
  };
}

const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
// 부산 필터. 예전에는 TourAPI 자체 지역코드(areaCode=6)로 걸렀지만, KorService2가 신규 축제
// 레코드의 areacode/sigungucode를 빈 문자열로 내려주기 시작해 그 필터에 아무것도 걸리지 않는다
// (2026-08-21 실측: 전국 236건 중 235건이 areacode='' — areaCode를 6/1/4/31/39 무엇으로 줘도
// 0건이고, areaCode 없이 조회해야 236건이 나온다). 부산 축제는 종료일 20260222 건을 마지막으로
// 더 잡히지 않아 그 뒤 모든 동기화가 조용히 0건이었다.
// 응답에 새로 들어온 법정동 시도코드로 필터를 옮긴다(26 = 부산광역시. 실측 14건, 오탐 0건).
const LDONG_REGN_CD = '26';
// 저장용 지역코드. 위 필터가 부산만 통과시키므로 상수이며, 시더(seed-festivals-csv)가 쓰는
// 값과 같은 KTO 체계다. 응답의 areacode는 이제 비어 오므로 그대로 쓰면 컬럼이 비어버린다.
const AREA_CODE = '6';
/**
 * 법정동 시군구코드(26xxx의 뒤 3자리) → KTO 시군구코드(부산 1~16).
 * festivals.sigungucode는 시더가 seed-spots-csv의 BUSAN_SIGUNGU_CODE_BY_NAME으로 채우는
 * 컬럼이라 반드시 같은 체계를 써야 한다. 법정동 코드를 그대로 넣으면 upsert의 COALESCE가
 * 시더 값을 덮어써(EXCLUDED가 non-null) 마지막에 실행한 쪽 값이 남고, 구 단위 노출이 깨진다.
 */
const KTO_SIGUNGU_BY_LDONG: Record<string, string> = {
  '110': '15', // 중구
  '140': '11', // 서구
  '170': '5', // 동구
  '200': '14', // 영도구
  '230': '7', // 부산진구
  '260': '6', // 동래구
  '290': '4', // 남구
  '320': '8', // 북구
  '350': '16', // 해운대구
  '380': '10', // 사하구
  '410': '2', // 금정구
  '440': '1', // 강서구
  '470': '13', // 연제구
  '500': '12', // 수영구
  '530': '9', // 사상구
  '710': '3', // 기장군
};
const NUM_OF_ROWS = 100;
// searchFestival2의 eventStartDate는 "시작일이 이 날짜 이후"가 아니라 "이 날짜 이후까지
// 진행되는 축제"로 동작한다(2026-02-09 조회에 시작일 2025-12-05인 트리축제가 잡히는 것으로
// 확인). 따라서 과거로 넉넉히 잡아도 시작일이 오래된 장기 축제를 더 건지지는 못하고,
// 이미 종료된 축제까지 가져와 findAll에서 걸러지기만 한다.
// 그럼에도 0이 아닌 값을 두는 이유는 아래 정리 로직 때문이다 — 최근 종료된 축제가 응답에
// 들어와야 "API가 더 이상 주지 않는 종료 축제"와 구분돼 즉시 삭제되지 않는다.
const LOOKBACK_DAYS = 180;
// 외부 API 단일 요청 상한(ms). 없으면 TourAPI가 응답을 끊지 않을 때 동기화 잡이 무한정
// 살아 있고, 프로세서 동시성이 1이라 다음 날 잡부터 뒤에 쌓인다.
const FETCH_TIMEOUT_MS = 10_000;

/** upsert 대상 컬럼. INSERT 컬럼 목록과 ON CONFLICT SET 절을 같은 순서로 만든다. */
const UPSERT_COLUMNS = [
  'contentId',
  'title',
  'addr1',
  'mapX',
  'mapY',
  'firstimage',
  'tel',
  'eventStartDate',
  'eventEndDate',
  'areacode',
  'sigungucode',
  'updatedAt',
] as const;

/** 동기화 한 건. 누락 필드는 undefined가 아니라 명시적 null로 채운다(아래 upsertBatch 주석 참고). */
type FestivalRow = {
  contentId: string;
  title: string;
  addr1: string | null;
  mapX: number | null;
  mapY: number | null;
  firstimage: string | null;
  tel: string | null;
  eventStartDate: string;
  eventEndDate: string;
  areacode: string | null;
  sigungucode: string | null;
  updatedAt: Date;
};

/**
 * 원본 필드를 문자열로 정규화하고 빈 값을 null로 만든다. **원본을 읽는 유일한 입구다.**
 *
 * 두 가지를 함께 처리한다.
 * - 빈 문자열 → null: TourAPI는 값이 없는 필드를 ''로 주는 일이 잦은데, ''는 null이 아니라서
 *   아래 COALESCE 보존 로직을 통과해 멀쩡한 기존 값을 ''로 덮어쓴다.
 * - 숫자 → 문자열: 코드 필드가 '26'이 아니라 26으로 오면 .trim()이 TypeError를 던지고,
 *   syncFromApi 루프에 try/catch가 없어 배치 전체가 죽는다. 지역 필터가 조용히 0건이 되는
 *   것을 로그로 드러내려던 변경이 반대로 무음 크래시를 만드는 셈이라 여기서 흡수한다.
 * - 그 외 타입(객체·불리언 등) → null: 억지로 문자열화하면 '[object Object]' 같은 값이
 *   DB까지 흘러간다. 값이 없는 것으로 보는 편이 안전하다.
 */
function nullIfBlank(value?: ApiValue): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCoord(value?: ApiValue): number | null {
  const text = nullIfBlank(value);
  if (!text) return null;
  const n = parseFloat(text);
  return isFinite(n) ? n : null;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. 8자리 숫자가 아니면 null. */
function parseYmd(value?: ApiValue): string | null {
  const text = nullIfBlank(value);
  if (!text || !/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/**
 * 응답이 주는 지역 근거로 이 축제가 부산인지 판정한다.
 *
 * 'other'만 버린다 — 부산이 **아니라는 근거가 있는** 행만 제외하고, 근거가 아예 없으면
 * ('unknown') 통과시켜 필드 누락으로 멀쩡한 축제를 잃지 않는다. 대신 'unknown'인 행에는
 * 지역 컬럼을 채우지 않는다. 근거가 없다면서 부산으로 라벨링하는 건 앞뒤가 안 맞고,
 * upstream이 lDongRegnCd를 무시해 전국 데이터가 들어왔을 때 그 오염이 그대로 저장된다.
 *
 * 근거는 권위 순으로 **하나만** 채택한다. 여러 근거가 엇갈릴 때(경계 지역, 주최지와
 * 주소가 다른 축제 등) 약한 근거로 멀쩡한 행을 버리지 않기 위함이다.
 */
type RegionVerdict = 'busan' | 'other' | 'unknown';

function regionOf(
  regnCd: string | null,
  apiAreaCode: string | null,
  addr1: string | null,
): RegionVerdict {
  if (regnCd) return regnCd === LDONG_REGN_CD ? 'busan' : 'other';
  if (apiAreaCode) return apiAreaCode === AREA_CODE ? 'busan' : 'other';
  // 여기서 districtNameFromAddress를 쓰면 안 된다. 그 함수는 "이미 부산으로 확인된
  // 주소"에서 구 이름을 뽑는 용도라 타 시도를 걸러내지 못한다 — 서울 강서구, 대구 서구,
  // 광주 남구, 인천 동구가 전부 부산으로 오판된다. 지역 판정은 접두사로만 한다.
  if (addr1) return addr1.startsWith('부산') ? 'busan' : 'other';
  return 'unknown';
}

/**
 * API가 준 sigungucode는 **KTO 부산 코드일 때만** 채택한다.
 *
 * festivals.sigungucode는 시더(seed-festivals-csv)도 쓰는 컬럼이고 구 단위 집계의
 * GROUP BY 키다. 시더는 VALID_SIGUNGU_CODES로 걸러 모르는 값을 null로 떨어뜨리는데
 * (seed-festivals-csv의 normalizeSigungu), 동기화만 원본을 그대로 믿으면 같은 컬럼에
 * 쓰는 두 경로의 방어 수준이 달라진다.
 *
 * 이 PR이 areacode에서 겪은 것과 같은 변화 — upstream이 예고 없이 필드 의미를 바꿔
 * sigungucode에 법정동 코드('350'·'26350')를 채우기 시작하는 것 — 가 오면, 해운대구
 * 축제는 '350'이고 spots는 '16'이라 같은 구가 둘로 쪼개진다. 모르는 값은 채택하지 않고
 * 아래 환산·주소 폴백으로 넘겨, 체계가 섞이느니 비는 편을 택한다.
 */
function ktoSigunguFromApi(value: string | null): string | null {
  return value && VALID_SIGUNGU_CODES.has(value) ? value : null;
}

@Injectable()
export class FestivalsService {
  private readonly logger = new Logger(FestivalsService.name);

  constructor(
    @InjectRepository(Festival)
    private readonly festivalRepository: Repository<Festival>,
    private readonly config: ConfigService,
  ) {}

  /**
   * 진행 중/예정 축제 목록. status 생략 시 종료되지 않은 축제(진행 중 + 예정)를
   * 시작일 오름차순으로 반환한다. 기준 날짜는 KST 오늘.
   */
  async findAll(status?: FestivalStatus) {
    const today = kstDateString();
    const qb = this.festivalRepository
      .createQueryBuilder('festival')
      .orderBy('festival.eventStartDate', 'ASC')
      .addOrderBy('festival.eventEndDate', 'ASC');

    if (status === 'ongoing') {
      qb.where('festival.eventStartDate <= :today', { today }).andWhere(
        'festival.eventEndDate >= :today',
        { today },
      );
    } else if (status === 'upcoming') {
      // eventEndDate 조건이 없으면 종료일 < 시작일인 비정상 행이 upcoming에만 잡혀
      // 기본 목록(= 진행 중 + 예정)과 어긋난다.
      qb.where('festival.eventStartDate > :today', { today }).andWhere(
        'festival.eventEndDate >= :today',
        { today },
      );
    } else {
      // 기본: 아직 끝나지 않은 축제(진행 중 + 예정)
      qb.where('festival.eventEndDate >= :today', { today });
    }

    // 페이지네이션이 없어 count는 items 길이와 같다 — 별도 COUNT 쿼리를 아낀다.
    const items = await qb.getMany();
    return { items, count: items.length };
  }

  /**
   * TourAPI searchFestival2로 부산 축제를 동기화(upsert)한다. 일 1회 배치에서 호출.
   * TOUR_API_KEY가 없으면 예외 없이 스킵한다(배치가 죽지 않도록).
   */
  async syncFromApi(): Promise<{ synced: number; deleted: number }> {
    const serviceKey = this.config.get<string>('TOUR_API_KEY');
    if (!serviceKey) {
      this.logger.warn('TOUR_API_KEY 미설정 — 축제 동기화 스킵');
      return { synced: 0, deleted: 0 };
    }

    const eventStartDate = kstYyyymmdd(new Date(), -LOOKBACK_DAYS);
    const { total, items: page1Items } = await this.fetchPage(
      serviceKey,
      1,
      eventStartDate,
    );
    // totalCount를 숫자로 못 읽으면 페이지 수가 NaN이 되고, `page <= NaN`이 false라 루프가
    // 통째로 안 돈다 — 0건 경고에도 안 걸려(NaN !== 0) 완전 무음이 된다. 최소 1페이지는
    // 처리하도록 폴백하고, 원인을 경고로 남긴다.
    const pagesKnown = Number.isFinite(total);
    const totalPages = pagesKnown
      ? Math.max(1, Math.ceil(total / NUM_OF_ROWS))
      : 1;
    this.logger.log(`축제 총 ${total}건 / ${totalPages}페이지`);
    if (!pagesKnown) {
      this.logger.warn(
        `축제 API totalCount를 숫자로 읽지 못했다(${String(total)}) — 1페이지만 처리한다. 응답 스키마 변경 여부 확인 필요`,
      );
    }
    // 0건은 정상 상태가 아니다 — 부산은 상시 진행 중이거나 예정된 축제가 있다. 지역 필터가
    // upstream 스키마 변경으로 무력화되면 HTTP도 resultCode도 정상이라 예외 없이 조용히
    // 0건이 되고(위 areaCode 사례), 아래 정리 로직도 스킵돼 겉보기엔 아무 일도 없다.
    // 다음 회귀를 로그에서 바로 잡을 수 있도록 경고로 남긴다.
    if (total === 0) {
      this.logger.warn(
        '축제 API가 0건 반환 — 지역 필터 파라미터/응답 스키마 변경 여부 확인 필요',
      );
    }

    // upsert의 ON CONFLICT UPDATE에 실려 재동기화 시각을 갱신한다(엔티티 주석 참고).
    const syncedAt = new Date();
    const syncedContentIds: string[] = [];
    let skipped = 0;
    const unexpectedSigungu = new Set<string>();
    for (let page = 1; page <= totalPages; page++) {
      const items =
        page === 1
          ? page1Items
          : (await this.fetchPage(serviceKey, page, eventStartDate)).items;

      const rows: FestivalRow[] = [];
      for (const item of items) {
        // title·contentId도 nullIfBlank를 거친다 — 여기서 직접 .trim()을 부르면 숫자로 온
        // 필드 하나에 배치 전체가 죽는다(nullIfBlank 주석 참고).
        const title = nullIfBlank(item.title);
        if (!title) continue;
        // contentId는 NOT NULL UNIQUE인 upsert 키다. 비면 배치 INSERT 전체가
        // not-null 위반으로 죽고, 빈 문자열이면 서로를 덮어쓴다.
        const contentId = nullIfBlank(item.contentid);
        if (!contentId) continue;
        // 0건 경고는 "필터가 아무것도 못 잡는" 방향만 막는다. 반대로 upstream이
        // lDongRegnCd를 모르는 파라미터로 취급해 무시하면(data.go.kr은 오류 대신 무시하는
        // 편이다) 전국 축제가 통째로 내려오는데, total > 0이라 경고에도 안 걸리고 부산 전용
        // 테이블이 오염된 채 그대로 API로 나간다. 여기서 부산이 아닌 행을 버린다(regionOf 주석).
        const regnCd = nullIfBlank(item.lDongRegnCd);
        const addr1 = nullIfBlank(item.addr1);
        const region = regionOf(regnCd, nullIfBlank(item.areacode), addr1);
        if (region === 'other') {
          skipped++;
          continue;
        }
        // 날짜가 없으면 진행 상태 판정이 불가능하므로 제외 (NOT NULL 컬럼)
        const eventStartDate = parseYmd(item.eventstartdate);
        const eventEndDate = parseYmd(item.eventenddate);
        if (!eventStartDate || !eventEndDate) continue;

        // 원본이 KTO 부산 코드가 아닌 sigungucode를 주기 시작하면 아래에서 조용히
        // 폴백으로 넘어간다. areacode가 그랬듯 스키마 변경의 첫 신호일 수 있어,
        // 어떤 값이 들어왔는지 표본을 모아 경고로 드러낸다.
        const apiSigungu = nullIfBlank(item.sigungucode);
        if (apiSigungu && !ktoSigunguFromApi(apiSigungu)) {
          unexpectedSigungu.add(apiSigungu);
        }

        rows.push({
          contentId,
          title,
          addr1,
          mapX: parseCoord(item.mapx),
          mapY: parseCoord(item.mapy),
          firstimage: nullIfBlank(item.firstimage),
          tel: nullIfBlank(item.tel),
          eventStartDate,
          eventEndDate,
          // 지역 컬럼은 부산으로 확인된 행에만 채운다. 근거 없는 행('unknown')을 부산으로
          // 찍으면 upstream 필터가 무력화됐을 때 전국 데이터가 부산으로 둔갑해 저장된다.
          // null이면 upsert의 COALESCE가 기존 값을 보존한다.
          areacode: region === 'busan' ? AREA_CODE : null,
          //
          // 구는 세 근거를 권위 순으로 본다.
          // 1) API가 준 sigungucode — 구형 레코드가 쓰는 KTO 체계 그대로다. 단 KTO 부산
          //    코드로 검증된 값만 쓴다(ktoSigunguFromApi) — 시더와 같은 방어 수준이다.
          // 2) 법정동 시군구코드 환산 — 3자리라 전국에서 유일하지 않지만('110'은 부산 중구이자
          //    서울 종로구의 접미 코드다) 이미 부산으로 확인된 행에서만 쓰므로 안전하다.
          //    환산표에 없으면 넘어간다 — 법정동 코드를 그대로 넣어 체계를 섞지 않는다.
          // 3) 주소의 구 이름 — lDongSignguCd 없이 주소로만 통과한 행이 구를 잃지 않게 한다.
          sigungucode:
            region === 'busan'
              ? (ktoSigunguFromApi(apiSigungu) ??
                KTO_SIGUNGU_BY_LDONG[nullIfBlank(item.lDongSignguCd) ?? ''] ??
                (addr1 ? ktoSigunguFromAddress(addr1) : null))
              : null,
          updatedAt: syncedAt,
        });
        syncedContentIds.push(contentId);
      }

      await this.upsertBatch(rows);

      this.logger.log(`[${page}/${totalPages}] ${rows.length}건 upsert`);
      if (page < totalPages) await new Promise((r) => setTimeout(r, 300));
    }

    if (skipped > 0) {
      this.logger.warn(
        `부산이 아닌 축제 ${skipped}건 제외 — 지역 필터가 무시됐는지 확인 필요`,
      );
    }

    // 표본은 앞 10종만 남긴다 — 전 행이 새 체계로 바뀌면 종류가 구 수만큼 늘어나
    // 로그 한 줄이 비대해진다. 어떤 체계로 바뀌었는지 알아보는 데는 몇 개면 충분하다.
    if (unexpectedSigungu.size > 0) {
      const sample = [...unexpectedSigungu].slice(0, 10).join(', ');
      this.logger.warn(
        `KTO 부산 시군구코드가 아닌 sigungucode ${unexpectedSigungu.size}종을 무시하고 ` +
          `법정동 환산·주소로 대체했다 (${sample}) — 원본 코드 체계 변경 여부 확인 필요`,
      );
    }

    // 받아온 건 있는데 저장한 게 없는 경우도 0건 응답과 증상이 같다 — 목록이 비고, 정리
    // 로직은 스킵되고, 로그에는 "총 N건"만 남아 정상으로 보인다. upstream이 areacode를
    // 비웠던 것처럼 eventenddate를 비우거나 이름을 바꾸면 전 행이 parseYmd에서 탈락해
    // 정확히 이 상태가 된다. 위 0건 경고와 같은 급으로 드러낸다.
    if (syncedContentIds.length === 0 && total !== 0) {
      this.logger.warn(
        `축제 API가 ${total}건을 반환했지만 저장 대상이 0건 — 필수 필드(제목·날짜) 스키마 변경 여부 확인 필요`,
      );
    }

    // API가 더 이상 주지 않고 이미 종료된 축제만 정리해 테이블 무한 증가를 막는다.
    // eventEndDate 조건을 함께 걸어, 혹시 API가 누락한 진행 중/예정 축제는 절대 지우지 않는다.
    // 응답이 비어 전부 지워버리는 사고를 막으려 동기화 건이 있을 때만 수행한다.
    const today = kstDateString();
    let deleted = 0;
    if (syncedContentIds.length > 0) {
      const result = await this.festivalRepository
        .createQueryBuilder()
        .delete()
        .where('"eventEndDate" < :today', { today })
        .andWhere('"contentId" NOT IN (:...ids)', { ids: syncedContentIds })
        .execute();
      deleted = result.affected ?? 0;
    }

    this.logger.log(
      `축제 동기화: upsert ${syncedContentIds.length}건, 정리 ${deleted}건`,
    );
    return { synced: syncedContentIds.length, deleted };
  }

  /**
   * contentId 기준 upsert. 이미 있는 축제는 **API가 실제로 값을 준 필드만** 갱신하고,
   * 주지 않은 필드(null)는 기존 값을 유지한다.
   *
   * TypeORM repository.upsert()를 쓰지 않는 이유: undefined 필드를 ON CONFLICT SET 절에서
   * 빼주긴 하는데, 그 SET 절이 **배치 전체의 합집합**으로 만들어진다. 한 배치에 좌표가 있는
   * 행과 없는 행이 섞이면(= 실제 동기화의 상시 상황) SET에 mapX가 포함되고, 좌표가 없는 행은
   * DEFAULT(NULL)로 들어가 **저장돼 있던 좌표를 NULL로 덮어쓴다.** 게다가 그 페이지 전원이
   * 좌표가 없으면 SET에서 빠져 보존되므로, 동작이 배치 구성에 따라 달라져 재현도 어렵다.
   *
   * COALESCE(EXCLUDED.x, festivals.x)로 "API가 준 값이 있으면 그것, 없으면 기존 값"을
   * 명시한다. 대신 upstream에서 필드가 의도적으로 삭제된 경우는 반영되지 않는다 —
   * TourAPI의 필드 누락은 대부분 일시적이라 데이터를 잃는 쪽보다 남기는 쪽을 택했다.
   */
  private async upsertBatch(rows: FestivalRow[]): Promise<void> {
    if (rows.length === 0) return;

    // 한 INSERT 안에 같은 contentId가 두 번 들어가면 ON CONFLICT DO UPDATE가
    // SQLSTATE 21000("cannot affect row a second time")으로 죽는다. API 응답에
    // 중복이 섞여도 동기화가 멈추지 않도록 뒤에 온 값을 남기고 접는다.
    const deduped = [
      ...new Map(rows.map((row) => [row.contentId, row])).values(),
    ];

    const params: unknown[] = [];
    const tuples = deduped.map((row) => {
      const placeholders = UPSERT_COLUMNS.map((col) => {
        params.push(row[col]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const columnList = UPSERT_COLUMNS.map((col) => `"${col}"`).join(', ');
    const updates = UPSERT_COLUMNS.filter((col) => col !== 'contentId')
      .map(
        (col) => `"${col}" = COALESCE(EXCLUDED."${col}", "festivals"."${col}")`,
      )
      .join(', ');

    await this.festivalRepository.query(
      `INSERT INTO "festivals" (${columnList})
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("contentId") DO UPDATE SET ${updates}`,
      params,
    );
  }

  private async fetchPage(
    serviceKey: string,
    pageNo: number,
    eventStartDate: string,
  ): Promise<{ items: FestivalItem[]; total: number }> {
    const params = new URLSearchParams({
      serviceKey,
      numOfRows: String(NUM_OF_ROWS),
      pageNo: String(pageNo),
      MobileOS: 'ETC',
      MobileApp: 'BTerritory',
      _type: 'json',
      arrange: 'A',
      lDongRegnCd: LDONG_REGN_CD,
      eventStartDate,
    });
    const url = `${BASE_URL}/searchFestival2?${params}`;

    // 타임아웃이 없으면 응답을 끊지 않는 API에 잡이 무한정 매달린다.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok)
      throw new Error(`축제 API HTTP 오류: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as FestivalApiResponse;

    const { resultCode, resultMsg } = data?.response?.header ?? {};
    if (resultCode !== '0000')
      throw new Error(`축제 API 응답 오류: ${resultCode} ${resultMsg}`);

    const body = data?.response?.body;
    const raw = body?.items === '' ? undefined : body?.items?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return { items, total: Number(body?.totalCount ?? 0) };
  }
}
