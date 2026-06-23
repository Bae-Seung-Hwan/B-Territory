import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Spot } from './entities/spot.entity';

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
    const { page = 1, limit = 20, areacode, sigungucode, contenttypeid } = query;

    const qb = this.spotRepository.createQueryBuilder('spot');

    if (areacode) qb.andWhere('spot.areacode = :areacode', { areacode });
    if (sigungucode) qb.andWhere('spot.sigungucode = :sigungucode', { sigungucode });
    if (contenttypeid) qb.andWhere('spot.contenttypeid = :contenttypeid', { contenttypeid });

    const [items, total] = await qb
      .select(['spot.id', 'spot.contentId', 'spot.title', 'spot.addr1', 'spot.mapX', 'spot.mapY', 'spot.firstimage', 'spot.contenttypeid', 'spot.areacode', 'spot.sigungucode'])
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
}
