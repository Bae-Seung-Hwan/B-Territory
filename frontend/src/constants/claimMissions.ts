import type { ClaimMission, MissionType } from '@/api/claims';

interface Coords {
  latitude: number;
  longitude: number;
}

/** 상세 시트에 버튼 하나로 그려지는 점령 미션. */
export interface MissionOption {
  type: MissionType;
  /** 준비가 끝나 바로 보낼 수 있는 증빙. null이면 아직 시도할 수 없다. */
  mission: ClaimMission | null;
  /** mission이 null인 이유(i18n 키). 준비됐으면 null. */
  blockedReasonKey: string | null;
}

/** 미션이 필요로 하는 화면 상태. 미션이 늘면 필요한 것만 여기에 추가한다. */
export interface MissionInputs {
  coords: Coords | null;
}

/**
 * 지금 이 관광지에서 시도할 수 있는 점령 미션 목록.
 *
 * "어떤 미션이 있고 각각 무엇이 준비돼야 하는가"를 이 함수 하나로 모아, 상세 시트는 목록을
 * 그리기만 하면 되게 한다. 새 미션은 여기에 항목을 추가하고 i18n에 button/rejected 문구만
 * 채우면 UI가 따라온다.
 */
export function availableMissions({ coords }: MissionInputs): MissionOption[] {
  return [
    {
      type: 'GPS_VISIT',
      mission: coords
        ? { type: 'GPS_VISIT', lat: coords.latitude, lng: coords.longitude }
        : null,
      blockedReasonKey: coords ? null : 'map.missions.GPS_VISIT.blocked',
    },
  ];
}

/** 미션 버튼 문구의 i18n 키 */
export function missionButtonKey(type: MissionType): string {
  return `map.missions.${type}.button`;
}

/** 서버가 400(자격 미달)을 준 이유 — 미션마다 다르므로 미션별 문구를 쓴다 */
export function missionRejectedKey(type: MissionType): string {
  return `map.missions.${type}.rejected`;
}
