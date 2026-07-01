import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Spot } from './entities/spot.entity';

export interface SpotListQuery {
  page?: number;
  limit?: number;
  areacode?: string;
  sigungucode?: string;
  contenttypeid?: string;
}

interface TourItem {
  contentid: string;
  title: string;
  addr1?: string;
  mapx?: string;
  mapy?: string;
  firstimage?: string;
  contenttypeid?: string;
  areacode?: string;
  sigungucode?: string;
}

interface TourApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: { item: TourItem | TourItem[] };
      totalCount: number | string;
    };
  };
}

const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const AREA_CODE = '6'; // 부산
const NUM_OF_ROWS = 100;

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}

@Injectable()
export class SpotsService {
  private readonly logger = new Logger(SpotsService.name);

  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: SpotListQuery) {
    const {
      page = 1,
      limit = 20,
      areacode,
      sigungucode,
      contenttypeid,
    } = query;

    const qb = this.spotRepository.createQueryBuilder('spot');

    if (areacode) qb.andWhere('spot.areacode = :areacode', { areacode });
    if (sigungucode)
      qb.andWhere('spot.sigungucode = :sigungucode', { sigungucode });
    if (contenttypeid)
      qb.andWhere('spot.contenttypeid = :contenttypeid', { contenttypeid });

    const [items, total] = await qb
      .select([
        'spot.id',
        'spot.contentId',
        'spot.title',
        'spot.addr1',
        'spot.mapX',
        'spot.mapY',
        'spot.firstimage',
        'spot.contenttypeid',
        'spot.areacode',
        'spot.sigungucode',
      ])
      .orderBy('spot.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit };
  }

  async findOne(id: number) {
    const spot = await this.spotRepository.findOne({ where: { id } });
    if (!spot) throw new NotFoundException(`Spot #${id}를 찾을 수 없습니다.`);
    return spot;
  }

  async syncFromApi(): Promise<{ synced: number; deleted: number }> {
    const serviceKey = this.config.get<string>('TOUR_API_KEY');
    if (!serviceKey) throw new Error('TOUR_API_KEY 환경변수가 필요합니다.');

    const { total, items: page1Items } = await this.fetchPage(serviceKey, 1);
    const totalPages = Math.ceil(total / NUM_OF_ROWS);
    this.logger.log(`총 ${total}건 / ${totalPages}페이지`);

    const syncedContentIds: string[] = [];

    for (let page = 1; page <= totalPages; page++) {
      const items =
        page === 1
          ? page1Items
          : (await this.fetchPage(serviceKey, page)).items;
      const validItems = items.filter((item) => item.title?.trim());

      if (validItems.length > 0) {
        await this.spotRepository.upsert(
          validItems.map((item) => ({
            contentId: item.contentid,
            title: item.title,
            addr1: item.addr1 ?? undefined,
            mapX: parseCoord(item.mapx) ?? undefined,
            mapY: parseCoord(item.mapy) ?? undefined,
            firstimage: item.firstimage ?? undefined,
            contenttypeid: item.contenttypeid ?? undefined,
            areacode: item.areacode ?? undefined,
            sigungucode: item.sigungucode ?? undefined,
          })),
          { conflictPaths: ['contentId'] },
        );
        syncedContentIds.push(...validItems.map((i) => i.contentid));
      }

      this.logger.log(`[${page}/${totalPages}] ${validItems.length}건 처리`);

      if (page < totalPages) await new Promise((r) => setTimeout(r, 300));
    }

    // API 응답에 없는 관광지 삭제 (폐업·제거된 관광지 정리)
    let deleted = 0;
    if (syncedContentIds.length > 0) {
      const existingCount = await this.spotRepository.count({
        where: { areacode: AREA_CODE },
      });

      if (syncedContentIds.length < existingCount * 0.5) {
        this.logger.warn(
          `동기화 건수(${syncedContentIds.length})가 기존(${existingCount})의 50% 미만 — 삭제 스킵`,
        );
        return { synced: syncedContentIds.length, deleted: 0 };
      }

      const result = await this.spotRepository
        .createQueryBuilder()
        .delete()
        .where('areacode = :areaCode AND "contentId" NOT IN (:...ids)', {
          areaCode: AREA_CODE,
          ids: syncedContentIds,
        })
        .execute();
      deleted = result.affected ?? 0;
    }

    return { synced: syncedContentIds.length, deleted };
  }

  private async fetchPage(
    serviceKey: string,
    pageNo: number,
  ): Promise<{ items: TourItem[]; total: number }> {
    const params = new URLSearchParams({
      serviceKey,
      numOfRows: String(NUM_OF_ROWS),
      pageNo: String(pageNo),
      MobileOS: 'ETC',
      MobileApp: 'BTerritorySeeder',
      _type: 'json',
      areaCode: AREA_CODE,
    });
    const url = `${BASE_URL}/areaBasedList2?${params}`;

    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`API HTTP 오류: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as TourApiResponse;

    const { resultCode, resultMsg } = data?.response?.header ?? {};
    if (resultCode !== '0000')
      throw new Error(`API 응답 오류: ${resultCode} ${resultMsg}`);

    const body = data?.response?.body;
    const raw = body?.items?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return { items, total: Number(body?.totalCount ?? 0) };
  }
}
