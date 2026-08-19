import { ValueTransformer } from 'typeorm';

/**
 * Postgres numeric/decimal 컬럼을 JS number로 왕복시키는 transformer.
 * TypeORM은 정밀도 손실을 피하려 decimal을 기본적으로 문자열로 반환하는데,
 * 좌표처럼 계산·직렬화에 number가 자연스러운 컬럼에 붙여 응답 타입을 엔티티 선언과 맞춘다.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null => {
    if (value === null || value === undefined) return null;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  },
};
