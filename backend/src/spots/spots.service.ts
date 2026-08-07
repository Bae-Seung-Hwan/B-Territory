import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Spot } from './entities/spot.entity';
import { ErrorCode, errBody } from '../common/errors/error-code';
import { resolveLang, pickText } from '../common/utils/lang.util';

export interface SpotListQuery {
  page?: number;
  limit?: number;
  areacode?: string;
  sigungucode?: string;
  contenttypeid?: string;
}

@Injectable()
export class SpotsService {
  constructor(
    @InjectRepository(Spot)
    private readonly spotRepository: Repository<Spot>,
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

  /**
   * 관광지 상세. lang(언어코드 ko/en 또는 국가코드 KR/US/…)에 맞춰 `description`을 골라준다.
   * 한/영 원문은 overview(ko)·overviewEn(en)으로 항상 함께 내려주되, 영문이 없으면
   * description은 한국어로 폴백한다.
   */
  async findOne(id: number, lang?: string) {
    const spot = await this.spotRepository.findOne({ where: { id } });
    if (!spot)
      throw new NotFoundException(
        errBody(ErrorCode.SPOT_NOT_FOUND, `Spot #${id}를 찾을 수 없습니다.`),
      );
    const resolved = resolveLang(lang);
    return {
      ...spot,
      lang: resolved,
      description: pickText(spot.overview, spot.overviewEn, resolved),
    };
  }
}
