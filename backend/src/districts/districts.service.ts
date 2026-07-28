import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { District } from './entities/district.entity';

interface DistrictCsvRow {
  sigunguCode: string;
  nameKo: string;
  nameEn: string;
  centerLat: number | null;
  centerLng: number | null;
  foreignVisitorShare: number | null;
  refPeriod: string | null;
  source: string | null;
  kmaNx: number | null;
  kmaNy: number | null;
}

// data/busan_districts.csv 컬럼 순서
const COLUMNS = 12;

function toNum(v: string): number | null {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class DistrictsService implements OnModuleInit {
  private readonly logger = new Logger(DistrictsService.name);
  // 런타임 가중치 조회용 캐시 (sigunguCode → weight)
  private weightCache = new Map<string, number>();

  constructor(
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 가중치는 점령 점수의 핵심이므로, 시딩/캐시 로드 실패를 조용히 삼켜 전 구를 1.0으로
    // degrade시키지 않고 부팅을 실패시킨다(fail-fast). CSV 경로 오류(예: Docker) 등이
    // 눈에 띄지 않게 넘어가는 것을 막는다.
    await this.seedFromCsv();
    await this.loadWeightCache();
    if (this.weightCache.size === 0) {
      throw new Error(
        `District 가중치 캐시가 비어 있습니다 — CSV 시딩 실패로 점령 점수 가중치가 모두 1.0이 됩니다. CSV 경로 확인 필요: ${this.csvPath()}`,
      );
    }

    // 정합성 검증은 경고성이므로 실패해도 부팅은 계속한다 (가중치 동작과 무관).
    try {
      await this.validateSpotSigungu();
    } catch (err) {
      this.logger.warn(
        'spots.sigungucode 정합성 검증 실패 (부팅은 계속)',
        err as Error,
      );
    }
  }

  private csvPath(): string {
    return (
      this.config.get<string>('DISTRICTS_CSV_PATH') ??
      resolve(process.cwd(), '../data/busan_districts.csv')
    );
  }

  private parseCsv(): DistrictCsvRow[] {
    // UTF-8 BOM 제거 후 라인 분리. 필드에 콤마가 없는 정적 파일이라 단순 split으로 충분.
    const content = readFileSync(this.csvPath(), 'utf8');
    const raw = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows: DistrictCsvRow[] = [];
    // 첫 줄은 헤더
    for (const line of lines.slice(1)) {
      const c = line.split(',');
      if (c.length < COLUMNS) {
        this.logger.warn(`컬럼 수 부족으로 스킵: ${line}`);
        continue;
      }
      rows.push({
        sigunguCode: c[0].trim(),
        nameKo: c[1].trim(),
        nameEn: c[2].trim(),
        centerLat: toNum(c[3]),
        centerLng: toNum(c[4]),
        foreignVisitorShare: toNum(c[5]),
        refPeriod: c[6].trim() || null,
        source: c[7].trim() || null,
        kmaNx: toNum(c[8]),
        kmaNy: toNum(c[9]),
      });
    }
    return rows;
  }

  async seedFromCsv(): Promise<void> {
    const rows = this.parseCsv();
    if (rows.length === 0) {
      this.logger.warn('District CSV에 유효한 행이 없어 시딩을 건너뜁니다.');
      return;
    }

    // 가중치 = share / (share 보유 구 평균). share 없는 구는 1.0.
    const shares = rows
      .map((r) => r.foreignVisitorShare)
      .filter((s): s is number => s !== null && s > 0);
    const meanShare =
      shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;

    const entities = rows.map((r) => {
      const weight =
        r.foreignVisitorShare && meanShare > 0
          ? r.foreignVisitorShare / meanShare
          : 1;
      return {
        sigunguCode: r.sigunguCode,
        nameKo: r.nameKo,
        nameEn: r.nameEn,
        centerLat: r.centerLat,
        centerLng: r.centerLng,
        foreignVisitorShare: r.foreignVisitorShare,
        refPeriod: r.refPeriod,
        source: r.source,
        kmaNx: r.kmaNx,
        kmaNy: r.kmaNy,
        scoreWeight: Number(weight.toFixed(4)),
      };
    });

    await this.districtRepo.upsert(entities, {
      conflictPaths: ['sigunguCode'],
    });
    this.logger.log(
      `District ${entities.length}개 시딩 완료 (평균 share=${meanShare.toFixed(6)})`,
    );
  }

  private async loadWeightCache(): Promise<void> {
    const all = await this.districtRepo.find();
    this.weightCache = new Map(
      all.map((d) => [d.sigunguCode, Number(d.scoreWeight)]),
    );
  }

  /** 점령 점수 가중치. 미등록 구는 1.0. */
  getWeight(sigunguCode: string | null | undefined): number {
    if (!sigunguCode) return 1;
    return this.weightCache.get(sigunguCode) ?? 1;
  }

  getWeightMap(): ReadonlyMap<string, number> {
    return this.weightCache;
  }

  /**
   * spots.sigungucode 중 districts에 없는 코드를 경고 로그로 알린다.
   * (데이터 납품 sigungucode 정합성 검증)
   */
  async validateSpotSigungu(): Promise<void> {
    const orphans = await this.dataSource.query<{ sigungucode: string }[]>(
      `SELECT DISTINCT s.sigungucode
         FROM spots s
         LEFT JOIN districts d ON d."sigunguCode" = s.sigungucode
        WHERE s.sigungucode IS NOT NULL AND d.id IS NULL`,
    );
    if (orphans.length > 0) {
      this.logger.warn(
        `districts에 없는 spots.sigungucode ${orphans.length}종: ${orphans
          .map((o) => o.sigungucode)
          .join(', ')}`,
      );
    } else {
      this.logger.log('spots.sigungucode 정합성 검증 통과');
    }
  }

  findAll(): Promise<District[]> {
    // sigunguCode는 varchar라 문자열 정렬 시 1,10,11,…,2 순이 되므로 숫자 캐스팅으로 정렬한다.
    return this.districtRepo
      .createQueryBuilder('d')
      .orderBy('CAST(d.sigunguCode AS integer)', 'ASC')
      .getMany();
  }

  findOne(sigunguCode: string): Promise<District | null> {
    return this.districtRepo.findOne({ where: { sigunguCode } });
  }
}
