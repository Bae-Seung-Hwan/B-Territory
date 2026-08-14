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
import {
  readCache,
  writeCache,
  writeCacheIfAbsent,
} from '../common/utils/redis-cache.util';
import { withTimeout } from '../common/utils/with-timeout.util';

// 수도로 지정된 구에서 점령하는 모든 팀의 점수(개인·팀)에 곱해지는 배수.
export const CAPITAL_MULTIPLIER = 1.2;

// 한 주(7일) + 여유 1일. 자기 주가 지나면 더 읽힐 일이 없으므로 그대로 만료되게 둔다.
const CAPITAL_TTL_SEC = 8 * 24 * 60 * 60;
// "이번 주 수도 없음"을 캐싱하는 sentinel 값과 그 TTL. sigunguCode는 항상 숫자 문자열이라
// 실제 값과 충돌하지 않는다. 미지정 상태를 캐싱하지 않으면 점령마다 Redis 미스 + DB findOne이
// 한 번씩 더 돈다. sentinel은 SET NX로만 쓰므로(writeCapitalNoneCache) 지정자가 이미 써둔
// 실제 수도를 덮지 않고, TTL도 짧게 잡아 지정이 늦게 반영되는 창을 줄인다.
const CAPITAL_NONE = '-';
const CAPITAL_NONE_TTL_SEC = 60;
// 부팅 시 이번 주 수도 보장(catch-up)을 기다리는 상한(ms). 초과하면 포기하고 부팅을 계속한다.
// 캐시 접근 자체의 상한은 공용 헬퍼(redis-cache.util)가 갖고 있다.
const CAPITAL_BOOT_TIMEOUT_MS = 3000;

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
  // 수도 캐시 키에 붙는 원장 식별자 — 최초 필요 시 한 번만 해석해 재사용한다(cacheNamespace).
  private cacheNs: Promise<string> | null = null;

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

    // 수도 캐시 키를 이 인스턴스가 보는 원장에 묶는다. 여기서 미리 해석해두면 이후 조회·지정이
    // 매번 DB를 치지 않고, 식별자를 못 읽는 환경(권한·접속 문제)이 부팅 로그에 드러난다.
    //
    // 실패해도 부팅은 계속한다 — 네임스페이스는 캐시 키에만 쓰이고, 런타임 경로(readCapitalCache
    // 등)는 이 실패를 이미 캐시 미스로 흡수해 DB 원장으로 답한다. 여기만 fail-fast로 두면
    // 캐시 전용 관심사 때문에 수도와 무관한 API까지 통째로 못 뜬다. cacheNamespace는 실패를
    // 메모하지 않으므로 다음 호출이 다시 시도한다.
    try {
      await this.cacheNamespace();
    } catch (err) {
      this.logger.warn(
        '수도 캐시 네임스페이스 해석 실패 (부팅은 계속) — 런타임에 재시도되고, 그때까지는 DB 원장으로 답한다',
        err as Error,
      );
    }

    // 이번 주 수도가 없으면 여기서 지정한다(놓친 주 catch-up).
    //
    // 주간 지정은 Bull repeatable cron이 담당하는데, Bull은 놓친 발화를 소급 실행하지 않는다.
    // 월요일 00:00 KST에 프로세스가 떠 있지 않았거나(배포·재기동), 부팅 시 Redis 순단으로
    // 잡 등록 자체가 실패했거나, DB 장애로 attempts를 모두 소진하면 그 주는 수도 없이 지나가고
    // 다시 시도하는 경로가 없다 — 12시간마다 도는 구 집계와 달리 한 번 놓치면 일주일이 날아간다.
    // 부팅마다 확인하면 재기동만으로 복구되고, designateWeeklyCapital은 weekStart 기준으로
    // 멱등이라 이미 지정된 주에는 아무것도 하지 않는다(Redis 캐시만 원장 값으로 맞춘다).
    //
    // best-effort다 — 실패해도 런타임 getCurrentCapital이 DB 원장을 직접 읽고, 다음 부팅이나
    // 다음 크론이 다시 시도한다. 부팅이 app.listen()에 도달하지 못하는 것만 막는다.
    try {
      await withTimeout(
        this.ensureCurrentWeekCapital(),
        CAPITAL_BOOT_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        '부팅 시 이번 주 수도 보장 실패/지연 (부팅은 계속) — 다음 크론/재기동에서 재시도',
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
   * 수도 캐시 키에 새길 원장 식별자 — "이 캐시가 어느 DB 원장을 근거로 만들어졌는지"를 키에
   * 담는다. 여러 환경(dev·test·prod)이 한 Redis를 공유하면 같은 주의 캐시 키가 그대로 겹쳐,
   * 다른 DB를 보는 인스턴스가 써넣은 수도를 읽어 자기 원장엔 없는 버프가 걸린다. 네임스페이스가
   * 다르면 서로의 키를 볼 일이 없어 이 오염이 원천 차단된다.
   *
   * system_identifier는 클러스터 고유값이지만 pg_control_system()이 기본적으로 superuser
   * 전용이라, 권한이 없으면 DB OID로 폴백한다(한 클러스터 안의 DB 구분에는 충분).
   *
   * 다만 같은 DB에 백업을 복구하거나 원장을 수동으로 지우는 경우는 네임스페이스가 그대로라
   * 여전히 캐시 TTL(최대 8일) 동안 옛 수도가 읽힐 수 있다. 그때는 캐시 키를 비우면 된다.
   */
  private async resolveCacheNamespace(): Promise<string> {
    try {
      return await this.queryCacheNamespace(
        `SELECT current_database() || ':' || system_identifier AS ns
           FROM pg_control_system()`,
      );
    } catch (err) {
      this.logger.warn(
        'system_identifier 조회 실패 — DB OID로 캐시 네임스페이스를 구성합니다 (권한 부족 추정)',
        err as Error,
      );
      return this.queryCacheNamespace(
        `SELECT current_database() || ':' || oid AS ns
           FROM pg_database WHERE datname = current_database()`,
      );
    }
  }

  /**
   * 두 쿼리 모두 정상 DB에서는 반드시 1행을 반환하지만, 빈 결과를 그대로 두면 row가 undefined가
   * 되어 "Cannot read properties of undefined"라는 엉뚱한 TypeError가 난다. 호출부(캐시 래퍼)는
   * 이 실패를 캐시 미스로 흡수하므로, 원인을 알아볼 수 있는 오류로 바꿔 던지는 것으로 충분하다.
   */
  private async queryCacheNamespace(sql: string): Promise<string> {
    const [row] = await this.dataSource.query<{ ns: string }[]>(sql);
    if (!row) {
      throw new Error(
        `캐시 네임스페이스 조회가 빈 결과를 반환했습니다: ${sql}`,
      );
    }
    return row.ns;
  }

  /**
   * 원장 식별자를 한 번만 조회해 재사용한다. onModuleInit이 미리 채우지만, 이 서비스의 init
   * 훅보다 먼저 도는 경로가 있어 지연 해석도 함께 지원한다 — Bull 프로세서는 코어 BullModule
   * (거리 2)에 속하고 Nest는 거리 내림차순으로 초기화하므로, 재시도 중이던 designate 잡이
   * DistrictsService.onModuleInit보다 먼저 실행될 수 있다. 고정 플레이스홀더를 쓰면 그때
   * 아무도 읽지 않는 키에 캐시를 쓰게 되므로, 필요한 시점에 해석해 항상 올바른 키를 만든다.
   * 실패하면 메모를 비워 다음 호출이 다시 시도한다.
   */
  private async cacheNamespace(): Promise<string> {
    if (!this.cacheNs) {
      this.cacheNs = this.resolveCacheNamespace().catch((err: unknown) => {
        this.cacheNs = null;
        throw err;
      });
    }
    return this.cacheNs;
  }

  /**
   * 해당 주의 수도(sigunguCode)를 담는 Redis 공유 키 — 모든 인스턴스가 이 값을 단일 소스로
   * 읽는다. 인메모리 캐시로 두면 수도를 지정한 인스턴스만 갱신돼 다른 인스턴스가 최대 일주일간
   * stale해진다. e2e에서 공유 상태를 정리·검증할 때도 이 메서드로 키를 만든다.
   *
   * 키를 주 단위로 스코프하는 것이 중요하다. 단일 키('capital:current')로 두면 주가 바뀐 뒤에도
   * 지난주 값이 그대로 읽혀, "이번 주 수도"를 묻는 조회가 지난주 수도를 반환한다(캐시가 주 경계를
   * 모르기 때문). 주별 키는 주가 넘어가는 순간 자동으로 미스가 되어 DB 원장을 다시 보게 만든다.
   * 원장 식별자(resolveCacheNamespace)까지 붙여 환경 간 오염도 함께 막는다.
   */
  async capitalCacheKey(weekStart: Date): Promise<string> {
    return `capital:${await this.cacheNamespace()}:week:${weekStart.getTime()}`;
  }

  /**
   * 이번 주 수도가 원장에 없으면 지정한다(놓친 주 catch-up). 이미 있으면 재지정하지 않고
   * 캐시만 원장 값으로 맞춘다 — designateWeeklyCapital이 weekStart 기준으로 멱등이기 때문.
   */
  private async ensureCurrentWeekCapital(): Promise<void> {
    const designated = await this.designateWeeklyCapital();
    this.logger.log(
      designated
        ? `이번 주 수도 확인: ${designated.sigunguCode}`
        : '이번 주 수도: (지정 대상 없음)',
    );
  }

  /**
   * 수도 캐시 접근 — 실패를 모두 "미스"로 흡수한다(공용 헬퍼 redis-cache.util).
   *
   * 여기서 따로 감싸는 것은 키 생성 실패다. 키에는 원장 식별자가 들어가는데 그 해석이 DB를
   * 타므로, DB가 흔들리면 키를 만들지 못한다. 그 경우도 캐시 미스와 똑같이 다뤄야 조회가
   * 500이 되지 않는다 — 캐시는 원장을 뒤따르는 값일 뿐이고 원장이 진실의 원천이다.
   */
  private async readCapitalCache(weekStart: Date): Promise<string | null> {
    try {
      const key = await this.capitalCacheKey(weekStart);
      return await readCache(this.redis, key, this.logger);
    } catch (err) {
      this.logger.warn(
        '수도 캐시 키 생성 실패 — DB 원장으로 폴백',
        err as Error,
      );
      return null;
    }
  }

  /**
   * 수도 캐시 재적재 — best-effort. 지정 경로에서도 반드시 이 래퍼를 쓴다. 맨 redis.set()은
   * Redis 미도달 시 재시도 소진까지(실측 12~24초) 매달려 주간 지정 잡을 통째로 실패시킨다.
   */
  private async writeCapitalCache(
    weekStart: Date,
    sigunguCode: string,
  ): Promise<void> {
    try {
      const key = await this.capitalCacheKey(weekStart);
      await writeCache(
        this.redis,
        key,
        sigunguCode,
        CAPITAL_TTL_SEC,
        this.logger,
      );
    } catch (err) {
      this.logger.warn('수도 캐시 키 생성 실패 (조회는 계속)', err as Error);
    }
  }

  /**
   * "이번 주 수도 없음"을 캐싱 — 반드시 SET NX여야 한다.
   *
   * 이 값을 쓰는 쪽은 조회자(원장 미스)인데, 같은 순간 지정자가 이미 실제 수도를 캐시에
   * 써뒀을 수 있다. 크론이 도는 월요일 00:05 근처가 정확히 그 창이다 — 조회자가 findOne을
   * 지정자의 INSERT 커밋 직전에 실행하면 null을 받고, 그 뒤에 sentinel을 덮어써 클러스터
   * 전체가 최대 TTL 동안 "수도 없음"으로 응답한다(수도 구 점령이 1.2배 대신 1.0배).
   */
  private async writeCapitalNoneCache(weekStart: Date): Promise<void> {
    try {
      const key = await this.capitalCacheKey(weekStart);
      await writeCacheIfAbsent(
        this.redis,
        key,
        CAPITAL_NONE,
        CAPITAL_NONE_TTL_SEC,
        this.logger,
      );
    } catch (err) {
      this.logger.warn('수도 캐시 키 생성 실패 (조회는 계속)', err as Error);
    }
  }

  /**
   * 이번 주 수도 sigunguCode. 모든 인스턴스가 공유하는 Redis 값을 단일 소스로 읽는다.
   * 캐시 미스든 Redis 도달 불가든 DB 원장에서 복구하고 재적재한다.
   *
   * 판정 기준은 "이번 주(월요일 00:00 KST) 지정 행"이지 "가장 최근 지정 행"이 아니다.
   * 최신 행을 쓰면 어떤 이유로든 이번 주 지정이 누락됐을 때 지난주 수도가 무기한 유효한
   * 것처럼 보인다(캐시 TTL이 만료돼도 DB 폴백이 같은 값을 다시 써넣어 되살아난다).
   * 이번 주 지정이 없으면 "수도 없음"이 정직한 답이고, 부팅 catch-up이 곧 채운다. 그 "없음"도
   * 짧은 TTL로 캐싱한다 — 캐싱하지 않으면 미지정 구간의 모든 점령이 Redis 미스 + DB findOne을
   * 한 번씩 더 돈다.
   */
  async getCurrentCapital(now: Date = new Date()): Promise<string | null> {
    const weekStart = startOfKstWeek(now);
    const cached = await this.readCapitalCache(weekStart);
    if (cached === CAPITAL_NONE) return null;
    if (cached !== null) return cached;
    const current = await this.capitalRepo.findOne({ where: { weekStart } });
    if (!current) {
      await this.writeCapitalNoneCache(weekStart);
      return null;
    }
    await this.writeCapitalCache(weekStart, current.sigunguCode);
    return current.sigunguCode;
  }

  /** 수도 점수 배수. 이번 주 수도인 구는 CAPITAL_MULTIPLIER, 그 외 1.0. */
  async getCapitalMultiplier(
    sigunguCode: string | null | undefined,
  ): Promise<number> {
    if (!sigunguCode) return 1;
    const current = await this.getCurrentCapital();
    return current === sigunguCode ? CAPITAL_MULTIPLIER : 1;
  }

  /** 직전 주 수도 sigunguCode (없으면 null) — 연속 중복 지정을 피하기 위한 제외 대상. */
  private async previousWeekCapital(weekStart: Date): Promise<string | null> {
    // weekStart 직전 1ms가 속한 주 = 직전 주.
    const prevWeekStart = startOfKstWeek(new Date(weekStart.getTime() - 1));
    const prev = await this.capitalRepo.findOne({
      where: { weekStart: prevWeekStart },
    });
    return prev?.sigunguCode ?? null;
  }

  /**
   * 점령 가능한(좌표 있는) spot을 가진 구 하나를 무작위로 뽑는다. EXISTS로 구당 1행이라
   * spot 수와 무관하게 구 단위 균등 무작위가 된다.
   *
   * exclude(직전 주 수도)를 뺀 뒤 후보가 없으면 제외 없이 한 번 더 뽑는다 — 후보가 한 구뿐인
   * 상황(초기 데이터·테스트)에서 제외 규칙 때문에 수도가 아예 없어지는 것을 막기 위함.
   */
  private async pickCandidate(exclude: string | null): Promise<string | null> {
    const query = (excluded: string | null) =>
      this.dataSource.query<{ sigunguCode: string }[]>(
        `SELECT d."sigunguCode" AS "sigunguCode"
           FROM districts d
          WHERE EXISTS (
            SELECT 1 FROM spots s
             WHERE s.sigungucode = d."sigunguCode"
               AND s."mapX" IS NOT NULL AND s."mapY" IS NOT NULL
          )
            AND ($1::varchar IS NULL OR d."sigunguCode" <> $1)
          ORDER BY RANDOM()
          LIMIT 1`,
        [excluded],
      );

    const picked = await query(exclude);
    if (picked.length > 0) return picked[0].sigunguCode;
    if (exclude === null) return null;

    const fallback = await query(null);
    if (fallback.length === 0) return null;
    this.logger.warn(
      `직전 주 수도(${exclude}) 외 후보가 없어 연속 지정을 허용합니다.`,
    );
    return fallback[0].sigunguCode;
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
   *   되면 그 주 내내 버프가 아무에게도 적용되지 않기 때문. 직전 주 수도도 후보에서 뺀다
   *   (부산 구·군은 16개뿐이라 제외하지 않으면 연속 중복이 자주 나온다).
   */
  async designateWeeklyCapital(
    now: Date = new Date(),
  ): Promise<{ sigunguCode: string } | null> {
    const weekStart = startOfKstWeek(now);
    const existing = await this.capitalRepo.findOne({ where: { weekStart } });
    if (existing) {
      await this.writeCapitalCache(weekStart, existing.sigunguCode);
      this.logger.log(
        `이번 주 수도 이미 지정됨: ${existing.sigunguCode} — 재지정 건너뜀`,
      );
      return { sigunguCode: existing.sigunguCode };
    }

    const sigunguCode = await this.pickCandidate(
      await this.previousWeekCapital(weekStart),
    );
    if (sigunguCode === null) {
      this.logger.warn(
        '점령 가능한 spot을 가진 구가 없어 수도 지정을 건너뜁니다.',
      );
      return null;
    }

    // weekStart UNIQUE insert가 이번 주 승자를 원자적으로 확정한다. insert가 성공한 뒤에만
    // Redis 현재값을 세팅하므로 Redis는 항상 DB 이력을 뒤따른다. unique 위반이면 다른
    // 인스턴스/재시도가 먼저 확정한 것이므로 그 행을 읽어 채택한다.
    try {
      await this.capitalRepo.insert({ sigunguCode, weekStart });
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        const winner = await this.capitalRepo.findOne({ where: { weekStart } });
        if (!winner) {
          // 23505는 이번 주 행이 이미 커밋됐다는 뜻이고(경합 트랜잭션 커밋까지 insert가
          // 블록된다), READ COMMITTED에서 뒤이은 findOne은 반드시 그 행을 본다. 안 보이면
          // 전제가 깨진 것이므로 예외로 올려 Bull 재시도에 맡긴다 — 여기서 경합에 진 자신의
          // 랜덤 픽으로 대체하면 원장에 없는 수도가 8일 TTL로 공유 캐시에 박혀, weekStart
          // UNIQUE 설계가 막으려던 유령 수도가 그대로 재현된다.
          throw new Error(
            `이번 주 수도 unique 위반인데 확정 행을 읽지 못했습니다 (weekStart=${weekStart.toISOString()})`,
          );
        }
        await this.writeCapitalCache(weekStart, winner.sigunguCode);
        this.logger.log(
          `이번 주 수도 동시 지정 경합 — 확정된 수도 채택: ${winner.sigunguCode}`,
        );
        return { sigunguCode: winner.sigunguCode };
      }
      throw err;
    }

    await this.writeCapitalCache(weekStart, sigunguCode);
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
