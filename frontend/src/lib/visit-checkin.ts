import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'visit-checkin';

/**
 * 체크인 후 열리는 24시간 방문 창(missions.service.ts의 VISIT_WINDOW_SECONDS)을 기기에도
 * 보존한다. `ReviewMissionSection`이 시트가 닫힐 때(spot → null) 통째로 언마운트되므로,
 * 이게 없으면 체크인하고 자리를 옮겼다가 나중에 리뷰만 쓰려는 흐름이 매번 깨진다.
 *
 * 서버가 리뷰 제출 시점에 Redis로 방문 창을 다시 검증하므로(requireVisit), 이 값은 UI가
 * 근거 없이 재체크인(GPS 재검증)을 요구하지 않기 위한 낙관적 캐시일 뿐이다 — 실제 만료
 * 여부의 최종 판단은 항상 서버가 한다.
 *
 * 여러 관광지에 각각 체크인해 둘 수 있는 서버 모델(spotId별 Redis 키)과 맞추기 위해
 * spotId를 키로 하는 단일 맵을 저장한다.
 */
type StoredCheckins = Record<string, number>; // spotId -> expiresAt(epoch ms)

async function loadAll(): Promise<StoredCheckins> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof stored !== 'object' || stored === null) return {};

  const now = Date.now();
  const valid: StoredCheckins = {};
  for (const [spotId, expiresAt] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof expiresAt === 'number' && expiresAt > now) {
      valid[spotId] = expiresAt;
    }
  }
  return valid;
}

async function saveAll(checkins: StoredCheckins): Promise<void> {
  if (Object.keys(checkins).length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(checkins));
}

export async function saveVisitCheckin(spotId: number, expiresInSeconds: number): Promise<void> {
  const checkins = await loadAll();
  checkins[spotId] = Date.now() + expiresInSeconds * 1000;
  await saveAll(checkins);
}

/** 이 관광지의 방문 창이 (기기 기준으로) 아직 유효한지. 만료분 정리는 다음 저장 시점에 이뤄진다. */
export async function loadVisitCheckin(spotId: number): Promise<boolean> {
  const checkins = await loadAll();
  return spotId in checkins;
}

export async function clearVisitCheckin(spotId: number): Promise<void> {
  const checkins = await loadAll();
  delete checkins[spotId];
  await saveAll(checkins);
}
