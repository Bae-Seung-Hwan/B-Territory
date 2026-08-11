import { QueryFailedError } from 'typeorm';

// Postgres SQLSTATE 에러 코드. https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * TypeORM 에러에서 Postgres SQLSTATE 코드를 추출한다. QueryFailedError가 아니거나
 * driver 에러에 code가 없으면 undefined. unique/FK 위반 같은 DB 제약 충돌을 도메인
 * 예외(409 등)로 매핑할 때 세 곳(auth·claims·districts)이 공용으로 쓴다.
 */
export function pgErrorCode(err: unknown): string | undefined {
  if (err instanceof QueryFailedError) {
    return (err.driverError as { code?: string })?.code;
  }
  return undefined;
}
