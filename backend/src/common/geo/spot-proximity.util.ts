import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** 방문 인증 허용 반경(m). claims 점령·missions 인증이 공유하는 단일 기준. */
export const PROXIMITY_METERS = 50;

/**
 * 관광지 좌표 근접(50m) 검증 — 점령(claims.visit)과 미션 인증이 함께 쓰는 단일 규칙.
 * 통과 시 점수 가중치 계산용 sigungucode를 반환하고, 실패는 상황별 예외로 던진다:
 * - 관광지 없음 → 404
 * - 좌표 없음 → 400
 * - 50m 초과 → 400 (거리 안내 포함)
 */
export async function verifySpotProximity(
  dataSource: DataSource,
  spotId: number,
  lat: number,
  lng: number,
): Promise<string | null> {
  const result = await dataSource.query<
    {
      has_coords: boolean;
      within_range: boolean | null;
      distance: number | null;
      sigungucode: string | null;
    }[]
  >(
    `SELECT
       "mapX" IS NOT NULL AND "mapY" IS NOT NULL AS has_coords,
       CASE WHEN "mapX" IS NOT NULL AND "mapY" IS NOT NULL THEN
         ST_DWithin(
           ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           ${PROXIMITY_METERS}
         )
       END AS within_range,
       CASE WHEN "mapX" IS NOT NULL AND "mapY" IS NOT NULL THEN
         ROUND(
           ST_Distance(
             ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           )::numeric, 1
         )::float8
       END AS distance,
       sigungucode
     FROM spots WHERE id = $3`,
    [lng, lat, spotId],
  );

  if (!result.length) throw new NotFoundException('관광지를 찾을 수 없습니다.');
  if (!result[0].has_coords)
    throw new BadRequestException(
      '해당 관광지는 좌표 정보가 없어 방문 인증이 불가합니다.',
    );

  const { within_range, distance, sigungucode } = result[0];
  if (!within_range) {
    throw new BadRequestException(
      `방문 인증 실패: 현재 위치가 ${distance}m 떨어져 있습니다. (허용: ${PROXIMITY_METERS}m 이내)`,
    );
  }
  return sigungucode;
}
