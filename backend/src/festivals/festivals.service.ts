import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
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
// 이미 시작해 진행 중인 축제까지 놓치지 않도록 과거로 넉넉히 조회한다.
// (searchFestival2는 eventStartDate 이후 축제를 주므로 시작일이 오래된 장기 축제 대비)
const LOOKBACK_DAYS = 180;

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
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
      qb.where('festival.eventStartDate > :today', { today });
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

      const rows: QueryDeepPartialEntity<Festival>[] = [];
      for (const item of items) {
        if (!item.title?.trim()) continue;
        // 날짜가 없으면 진행 상태 판정이 불가능하므로 제외 (NOT NULL 컬럼)
        const eventStartDate = parseYmd(item.eventstartdate);
        const eventEndDate = parseYmd(item.eventenddate);
        if (!eventStartDate || !eventEndDate) continue;

        rows.push({
          contentId: item.contentid,
          title: item.title,
          addr1: item.addr1 ?? undefined,
          mapX: parseCoord(item.mapx) ?? undefined,
          mapY: parseCoord(item.mapy) ?? undefined,
          firstimage: item.firstimage ?? undefined,
          tel: item.tel ?? undefined,
          eventStartDate,
          eventEndDate,
          areacode: item.areacode ?? undefined,
          sigungucode: item.sigungucode ?? undefined,
          updatedAt: syncedAt,
        });
        syncedContentIds.push(item.contentid);
      }

      if (rows.length > 0) {
        await this.festivalRepository.upsert(rows, {
          conflictPaths: ['contentId'],
        });
      }

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

    const res = await fetch(url);
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
