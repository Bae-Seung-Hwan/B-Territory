import { DistrictsService } from './districts.service';
import { startOfKstWeek } from '../common/utils/kst.util';

/**
 * 수도 캐시 키의 원장 식별자(네임스페이스) 해석만 검증한다. 여러 환경이 한 Redis를 공유할 때
 * 서로의 캐시를 읽어 원장에 없는 버프가 걸리는 것을 막는 장치라, 키가 조용히 잘못 만들어지는
 * 경로(초기화 순서·권한 부족·일시적 DB 실패)를 여기서 고정한다. 지정·조회의 나머지 동작은
 * 실제 Postgres/Redis가 필요해 e2e(capital.e2e-spec)가 담당한다.
 */
describe('DistrictsService — 수도 캐시 네임스페이스', () => {
  const SYS_ID_SQL = 'pg_control_system';
  const OID_SQL = 'pg_database';

  function makeService(options?: {
    sysIdFails?: boolean;
    capitalRow?: { sigunguCode: string } | null;
  }) {
    // resolveCacheNamespace는 system_identifier를 먼저 시도하고, 권한이 없으면 DB OID로
    // 폴백한다. SQL 본문으로 분기해 두 경로를 각각 재현한다.
    const query = jest.fn((sql: string) => {
      if (sql.includes(SYS_ID_SQL)) {
        return options?.sysIdFails
          ? Promise.reject(new Error('permission denied for function'))
          : Promise.resolve([{ ns: 'b_territory:7412345678901234567' }]);
      }
      if (sql.includes(OID_SQL)) {
        return Promise.resolve([{ ns: 'b_territory:16384' }]);
      }
      return Promise.resolve([]);
    });
    const dataSource = { query };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      tryAcquireLock: jest.fn().mockResolvedValue(true),
    };
    const capitalRepo = {
      findOne: jest.fn().mockResolvedValue(options?.capitalRow ?? null),
    };
    const service = new DistrictsService(
      {} as never,
      capitalRepo as never,
      dataSource as never,
      {} as never,
      redis as never,
    );
    return { service, query, redis, capitalRepo };
  }

  const weekStart = startOfKstWeek(new Date('2026-08-11T12:00:00+09:00'));

  it('onModuleInit 전에 호출돼도 원장 식별자가 붙은 키를 만든다', async () => {
    // Bull 프로세서는 코어 BullModule(거리 2)에 속하고 Nest는 거리 내림차순으로 초기화하므로,
    // 재시도 중이던 designate 잡이 이 서비스의 init 훅보다 먼저 돌 수 있다. 그때 고정
    // 플레이스홀더가 쓰이면 아무도 읽지 않는 키에 캐시를 쓰게 된다.
    const { service } = makeService();

    await expect(service.capitalCacheKey(weekStart)).resolves.toBe(
      `capital:b_territory:7412345678901234567:week:${weekStart.getTime()}`,
    );
  });

  it('식별자를 한 번만 해석하고 이후 호출은 재사용한다', async () => {
    const { service, query } = makeService();

    const keys = await Promise.all([
      service.capitalCacheKey(weekStart),
      service.capitalCacheKey(weekStart),
      service.capitalCacheKey(weekStart),
    ]);

    expect(new Set(keys).size).toBe(1);
    // 점령마다 DB를 다시 치면 캐시를 두는 의미가 없다 — 동시 호출도 한 번으로 합쳐져야 한다.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('system_identifier 조회 권한이 없으면 DB OID로 폴백한다', async () => {
    // pg_control_system()은 기본적으로 superuser 전용이라, 앱 DB 유저가 일반 권한이면
    // 여기서 막힌다. 폴백이 없으면 키를 아예 만들지 못해 캐시가 통째로 죽는다.
    const { service, query } = makeService({ sysIdFails: true });

    await expect(service.capitalCacheKey(weekStart)).resolves.toBe(
      `capital:b_territory:16384:week:${weekStart.getTime()}`,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('해석에 실패해도 고착되지 않고 다음 호출이 다시 시도한다', async () => {
    // 실패한 프로미스를 그대로 메모해두면 일시적 DB 순단이 프로세스 수명 내내 캐시를 죽인다.
    const { service, query } = makeService({ sysIdFails: true });
    query.mockImplementationOnce(() => Promise.reject(new Error('down')));
    query.mockImplementationOnce(() => Promise.reject(new Error('down')));

    await expect(service.capitalCacheKey(weekStart)).rejects.toThrow('down');

    await expect(service.capitalCacheKey(weekStart)).resolves.toBe(
      `capital:b_territory:16384:week:${weekStart.getTime()}`,
    );
  });

  it('식별자를 못 읽으면 캐시를 건너뛰고 DB 원장으로 답한다 (조회는 계속된다)', async () => {
    // 네임스페이스 실패가 조회를 500으로 만들면 안 된다 — 캐시는 원장을 뒤따르는 값일 뿐이라
    // 미스와 똑같이 취급하고 원장을 읽어야 한다.
    const { service, query, redis } = makeService({
      capitalRow: { sigunguCode: '16' },
    });
    // 식별자 조회 두 경로(system_identifier·DB OID)가 모두 막힌 상태.
    query.mockImplementation(() => Promise.reject(new Error('db down')));

    await expect(service.getCurrentCapital()).resolves.toBe('16');
    // 키를 만들지 못했으니 Redis는 아예 건드리지 않는다 — 엉뚱한 키로 읽고 쓰지 않는다.
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
