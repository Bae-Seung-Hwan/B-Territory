import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Festival } from './entities/festival.entity';
import { FestivalStatus } from './dto/festival-query.dto';
import { kstDateString, kstYyyymmdd } from '../common/utils/kst.util';

interface FestivalItem {
  contentid: string;
  title: string;
  addr1?: string;
  mapx?: string;
  mapy?: string;
  firstimage?: string;
  tel?: string;
  eventstartdate?: string; // 'YYYYMMDD'
  eventenddate?: string; // 'YYYYMMDD'
  areacode?: string;
  sigungucode?: string;
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
const AREA_CODE = '6'; // 부산
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

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}

/**
 * 빈 문자열을 null로 정규화한다. TourAPI는 값이 없는 필드를 ''로 주는 일이 잦은데,
 * ''는 null이 아니라서 아래 COALESCE 보존 로직을 통과해 멀쩡한 기존 값을 ''로 덮어쓴다.
 */
function nullIfBlank(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. 8자리 숫자가 아니면 null. */
function parseYmd(value?: string): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
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
    const totalPages = Math.max(1, Math.ceil(total / NUM_OF_ROWS));
    this.logger.log(`축제 총 ${total}건 / ${totalPages}페이지`);

    // upsert의 ON CONFLICT UPDATE에 실려 재동기화 시각을 갱신한다(엔티티 주석 참고).
    const syncedAt = new Date();
    const syncedContentIds: string[] = [];
    for (let page = 1; page <= totalPages; page++) {
      const items =
        page === 1
          ? page1Items
          : (await this.fetchPage(serviceKey, page, eventStartDate)).items;

      const rows: FestivalRow[] = [];
      for (const item of items) {
        if (!item.title?.trim()) continue;
        // contentId는 NOT NULL UNIQUE인 upsert 키다. 비면 배치 INSERT 전체가
        // not-null 위반으로 죽고, 빈 문자열이면 서로를 덮어쓴다.
        const contentId = item.contentid?.trim();
        if (!contentId) continue;
        // 날짜가 없으면 진행 상태 판정이 불가능하므로 제외 (NOT NULL 컬럼)
        const eventStartDate = parseYmd(item.eventstartdate);
        const eventEndDate = parseYmd(item.eventenddate);
        if (!eventStartDate || !eventEndDate) continue;

        rows.push({
          contentId,
          title: item.title.trim(),
          addr1: nullIfBlank(item.addr1),
          mapX: parseCoord(item.mapx),
          mapY: parseCoord(item.mapy),
          firstimage: nullIfBlank(item.firstimage),
          tel: nullIfBlank(item.tel),
          eventStartDate,
          eventEndDate,
          areacode: nullIfBlank(item.areacode),
          sigungucode: nullIfBlank(item.sigungucode),
          updatedAt: syncedAt,
        });
        syncedContentIds.push(contentId);
      }

      await this.upsertBatch(rows);

      this.logger.log(`[${page}/${totalPages}] ${rows.length}건 upsert`);
      if (page < totalPages) await new Promise((r) => setTimeout(r, 300));
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
      areaCode: AREA_CODE,
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
