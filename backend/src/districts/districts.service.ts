import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { District } from './entities/district.entity';
import { CapitalDesignation } from './entities/capital-designation.entity';
import { RedisService } from '../common/redis/redis.service';
import { startOfKstWeek } from '../common/utils/kst.util';
import {
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from '../common/utils/pg-error.util';

// 수도로 지정된 구에서 점령하는 모든 팀의 점수(개인·팀)에 곱해지는 배수.
export const CAPITAL_MULTIPLIER = 1.2;

// 현재 수도(sigunguCode)를 담는 Redis 공유 키 — 모든 인스턴스가 이 값을 단일 소스로 읽는다.
// 인메모리 캐시로 두면 수도를 지정한 인스턴스만 갱신돼 다른 인스턴스가 최대 일주일간 stale해진다.
const CAPITAL_CURRENT_KEY = 'capital:current';
// 주 1회 갱신되므로 2주 TTL이면 정상 운영 중엔 만료되지 않고, 지정이 멈추면 자동 정리된다.
const CAPITAL_TTL_SEC = 14 * 24 * 60 * 60;
// 부팅 시 수도 캐시 워밍(Redis)을 기다리는 상한(ms). 초과하면 워밍을 포기하고 부팅을 계속한다.
const CAPITAL_WARM_TIMEOUT_MS = 3000;
// 런타임 수도 캐시 접근 상한(ms). Redis 정상 응답은 1ms 미만이라 여유가 크고, 도달 불가일 때
// 요청이 maxRetriesPerRequest 소진까지(실측 12~24초) 매달리지 않도록 짧게 끊는다.
const CAPITAL_CACHE_TIMEOUT_MS = 500;

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
  // 런타임 가중치 조회용 캐시 (sigunguCode → weight). 부팅 시 CSV에서 로드되는 정적 값이라
  // 인스턴스별 메모리 캐시로 충분하다(모든 인스턴스가 같은 CSV로 동일하게 로드).
  private weightCache = new Map<string, number>();

  constructor(
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(CapitalDesignation)
    private readonly capitalRepo: Repository<CapitalDesignation>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
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

    // 수도 공유 캐시(Redis)를 DB 원장에서 워밍한다. 아직 지정 전이면 비어 있는 게 정상
    // (pre-season·최초 부팅)이므로 fail-fast하지 않는다. Redis에 이미 값이 있으면(다른
    // 인스턴스가 먼저 세팅) 덮어쓰지 않는다.
    //
    // 워밍은 best-effort다(런타임 getCurrentCapital이 Redis 미스 시 DB에서 self-heal).
    // Redis에 도달하지 못하면 ioredis 명령이 예외로 전환되기까지 수 초 걸릴 수 있어,
    // 부팅이 app.listen()에 도달하지 못하는 것을 막도록 타임아웃 + fail-open으로 감싼다.
    try {
      await this.withTimeout(this.warmCapitalCache(), CAPITAL_WARM_TIMEOUT_MS);
    } catch (err) {
      this.logger.warn(
        '수도 캐시 워밍 실패/지연 (부팅은 계속) — 런타임에 DB에서 self-heal됨',
        err as Error,
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

  /**
   * 프로미스가 ms 안에 끝나지 않으면 거부한다(부팅 논블로킹용). 타임아웃이 이겨도 원본
   * 프로미스의 지연 실패는 Promise.race 내부 핸들러가 처리하므로 unhandledRejection이 없다.
   */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms).unref();
      }),
    ]);
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

    // 음수 share는 유효하지 않은 데이터이므로 '없음'(null)으로 정규화한다. 이대로 두면
    // scoreWeight가 음수로 저장·캐시되고, 점령 응답(pointsAwarded 등)에 실제 기록되지
    // 않은 음수 점수가 노출되어 클라이언트에 오해를 준다. 조용히 넘기지 않고 경고를 남긴다.
    for (const r of rows) {
      if (r.foreignVisitorShare !== null && r.foreignVisitorShare < 0) {
        this.logger.warn(
          `sigungu ${r.sigunguCode}: 음수 foreign_visitor_share(${r.foreignVisitorShare}) → 무효 처리(가중치 1.0)`,
        );
        r.foreignVisitorShare = null;
      }
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
   * Redis 공유 캐시가 비어 있으면 DB 원장의 최신 지정으로 워밍한다(부팅·Redis 재시작 대비).
   * 이미 값이 있으면(다른 인스턴스가 세팅) 덮어쓰지 않는다.
   */
  private async warmCapitalCache(): Promise<void> {
    const cached = await this.readCapitalCache();
    if (cached !== null) {
      this.logger.log(`현재 수도(Redis): ${cached}`);
      return;
    }
    const latest = await this.capitalRepo.findOne({
      where: {},
      order: { designatedAt: 'DESC' },
    });
    if (latest) {
      await this.writeCapitalCache(latest.sigunguCode);
      this.logger.log(`현재 수도(DB→Redis 워밍): ${latest.sigunguCode}`);
    } else {
      this.logger.log('현재 수도: (미지정)');
    }
  }

  /**
   * 수도 캐시 읽기 — 실패를 "미스"로 흡수한다.
   *
   * Redis 미스(연결됨·키 없음)와 Redis 도달 불가는 호출부가 구분할 필요가 없다. 둘 다
   * DB 원장으로 폴백해야 하고, 원장이 진실의 원천이므로 결과도 같다. 감싸지 않으면
   * 도달 불가일 때 redis.get()이 null이 아니라 MaxRetriesPerRequestError를 던져
   * DB 폴백 라인에 도달조차 못 하고 조회가 500이 된다.
   */
  private async readCapitalCache(): Promise<string | null> {
    try {
      return await this.withTimeout(
        this.redis.get(CAPITAL_CURRENT_KEY),
        CAPITAL_CACHE_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn('수도 캐시 조회 실패 — DB 원장으로 폴백', err as Error);
      return null;
    }
  }

  /** 수도 캐시 재적재 — best-effort. 실패해도 DB 원장이 진실이라 조회는 계속된다. */
  private async writeCapitalCache(sigunguCode: string): Promise<void> {
    try {
      await this.withTimeout(
        this.redis.set(CAPITAL_CURRENT_KEY, sigunguCode, CAPITAL_TTL_SEC),
        CAPITAL_CACHE_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn('수도 캐시 재적재 실패 (조회는 계속)', err as Error);
    }
  }

  /**
   * 이번 주 수도 sigunguCode. 모든 인스턴스가 공유하는 Redis 값을 단일 소스로 읽는다.
   * 캐시 미스든 Redis 도달 불가든 DB 원장에서 복구하고 재적재한다. 지정 전이면 null.
   */
  async getCurrentCapital(): Promise<string | null> {
    const cached = await this.readCapitalCache();
    if (cached !== null) return cached;
    const latest = await this.capitalRepo.findOne({
      where: {},
      order: { designatedAt: 'DESC' },
    });
    if (!latest) return null;
    await this.writeCapitalCache(latest.sigunguCode);
    return latest.sigunguCode;
  }

  /** 수도 점수 배수. 현재 수도인 구는 CAPITAL_MULTIPLIER, 그 외 1.0. */
  async getCapitalMultiplier(
    sigunguCode: string | null | undefined,
  ): Promise<number> {
    if (!sigunguCode) return 1;
    const current = await this.getCurrentCapital();
    return current === sigunguCode ? CAPITAL_MULTIPLIER : 1;
  }

  /**
   * 주간 수도 지정 — 점령 가능한 구 하나를 무작위로 뽑아 이력(DB)에 append하고 현재 수도
   * (Redis 공유 키)를 갱신한다. "점수가 가장 높은 구"가 아니라 매주 무작위로 뽑는 것이 확정 기획.
   * 매주 월요일 00:00 KST 배치(capital-designation 큐)가 호출한다.
   *
   * - 멱등: 이번 주(월요일 00:00 KST 기준)에 이미 지정됐으면 재지정하지 않는다(DB 이력 기준).
   *   Bull 재시도(attempts:3)로 프로세서가 다시 실행돼도 수도가 주중에 바뀌지 않는다.
   * - 동시성/원자성: 이번 주 확정은 오직 weekStart UNIQUE 컬럼의 insert 성공으로만 이뤄진다.
   *   다중 인스턴스가 같은 주에 동시에 지정하거나 재시도가 겹쳐도 하나의 insert만 성공하고
   *   나머지는 unique 위반으로 걸러진 뒤 확정된 행을 채택한다. Redis(capital:current)는
   *   "확정된 DB 상태"를 반영하는 캐시일 뿐 승자 결정 권한이 없어, 락은 잡혔지만 DB 이력엔
   *   없는 "유령 수도" 상태가 생기지 않는다(일시적 DB 실패는 예외 전파 → Bull 재시도로 흡수).
   * - 후보 제한: 좌표 있는 spot을 최소 1개 가진 구 중에서만 뽑는다. spot이 없는 구가 수도가
   *   되면 그 주 내내 버프가 아무에게도 적용되지 않기 때문.
   */
  async designateWeeklyCapital(
    now: Date = new Date(),
  ): Promise<{ sigunguCode: string } | null> {
    const weekStart = startOfKstWeek(now);
    const existing = await this.capitalRepo.findOne({ where: { weekStart } });
    if (existing) {
      await this.redis.set(
        CAPITAL_CURRENT_KEY,
        existing.sigunguCode,
        CAPITAL_TTL_SEC,
      );
      this.logger.log(
        `이번 주 수도 이미 지정됨: ${existing.sigunguCode} — 재지정 건너뜀`,
      );
      return { sigunguCode: existing.sigunguCode };
    }

    // 점령 가능한(좌표 있는) spot을 가진 구만 후보. EXISTS로 구당 1행이라 spot 수와
    // 무관하게 구 단위 균등 무작위가 된다.
    const picked = await this.dataSource.query<{ sigunguCode: string }[]>(
      `SELECT d."sigunguCode" AS "sigunguCode"
         FROM districts d
        WHERE EXISTS (
          SELECT 1 FROM spots s
           WHERE s.sigungucode = d."sigunguCode"
             AND s."mapX" IS NOT NULL AND s."mapY" IS NOT NULL
        )
        ORDER BY RANDOM()
        LIMIT 1`,
    );
    if (picked.length === 0) {
      this.logger.warn(
        '점령 가능한 spot을 가진 구가 없어 수도 지정을 건너뜁니다.',
      );
      return null;
    }
    const { sigunguCode } = picked[0];

    // weekStart UNIQUE insert가 이번 주 승자를 원자적으로 확정한다. insert가 성공한 뒤에만
    // Redis 현재값을 세팅하므로 Redis는 항상 DB 이력을 뒤따른다. unique 위반이면 다른
    // 인스턴스/재시도가 먼저 확정한 것이므로 그 행을 읽어 채택한다.
    try {
      await this.capitalRepo.insert({ sigunguCode, weekStart });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        const winner = await this.capitalRepo.findOne({ where: { weekStart } });
        const winnerCode = winner?.sigunguCode ?? sigunguCode;
        await this.redis.set(CAPITAL_CURRENT_KEY, winnerCode, CAPITAL_TTL_SEC);
        this.logger.log(
          `이번 주 수도 동시 지정 경합 — 확정된 수도 채택: ${winnerCode}`,
        );
        return { sigunguCode: winnerCode };
      }
      throw err;
    }

    await this.redis.set(CAPITAL_CURRENT_KEY, sigunguCode, CAPITAL_TTL_SEC);
    this.logger.log(
      `이번 주 수도 지정: ${sigunguCode} — 배수 ${CAPITAL_MULTIPLIER}x`,
    );
    return { sigunguCode };
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
