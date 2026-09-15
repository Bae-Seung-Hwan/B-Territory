import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERMISSION_NOTICE_VERSION } from '@/constants/app-permissions';

const STORAGE_KEY = 'permission-notice';

/**
 * `loading`은 "아직 모른다"이지 "고지하지 않았다"가 아니다 — 저장소를 읽기 전에 pending으로
 * 단정하면 앱을 켤 때마다 고지 화면이 잠깐 깜빡이고, acknowledged로 단정하면 첫 실행에
 * 고지 없이 권한을 묻는다. 두 소비자(고지 화면·use-location) 모두 이 상태에서는 기다린다.
 */
export type PermissionNoticeState = 'loading' | 'pending' | 'acknowledged';

let state: PermissionNoticeState = 'loading';
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: PermissionNoticeState): void {
  if (state === next) return;
  state = next;
  listeners.forEach((notify) => notify());
}

async function load(): Promise<void> {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    // 읽기 실패는 "확인한 적 없음"으로 본다. 고지를 한 번 더 보여줄 뿐이고, 반대로
    // 낙관했다가는 고지 없이 권한을 묻게 된다.
    stored = null;
  }
  // 읽는 사이 이용자가 이미 확인 버튼을 눌렀다면 그 결과를 덮지 않는다.
  if (state !== 'loading') return;
  setState(stored === PERMISSION_NOTICE_VERSION ? 'acknowledged' : 'pending');
}

export function ensurePermissionNoticeLoaded(): Promise<void> {
  loadPromise ??= load();
  return loadPromise;
}

export function getPermissionNoticeState(): PermissionNoticeState {
  return state;
}

/**
 * 저장소 조회가 끝난 뒤의 확인 여부. 위치 권한을 요청하기 **전에** 반드시 통과해야 하는
 * 관문이라 동기 스냅샷(`getPermissionNoticeState`)이 아니라 이 비동기 형태를 쓴다 —
 * 콜드스타트 직후에는 아직 `loading`이라, 동기로 읽으면 "확인 안 했음"과 구별되지 않는다.
 */
export async function isPermissionNoticeAcknowledged(): Promise<boolean> {
  await ensurePermissionNoticeLoaded();
  return state === 'acknowledged';
}

export async function acknowledgePermissionNotice(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, PERMISSION_NOTICE_VERSION);
  } catch {
    // 저장 실패로 진행을 막지 않는다 — 고지는 이미 화면에 표시했고 동의도 받았다. 여기서
    // 세우면 저장소가 막힌 기기에서 앱을 아예 쓸 수 없게 된다. 다음 실행에 다시 뜰 뿐이다.
  }
  setState('acknowledged');
}

function subscribe(onStoreChange: () => void): () => void {
  void ensurePermissionNoticeLoaded();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** 고지 화면의 표시 여부를 판단하는 훅. `pending`일 때만 화면을 띄운다. */
export function usePermissionNoticeState(): PermissionNoticeState {
  return useSyncExternalStore(subscribe, getPermissionNoticeState);
}

/**
 * 확인 여부가 바뀔 때 알림을 받는다(현재 소비자는 use-location 하나다).
 *
 * 훅이 따로 있는데도 이 구독구가 필요한 이유: 위치 권한 요청을 막는 쪽은 화면이 아니라
 * 모듈 스코프의 GPS 스토어라, React 렌더와 무관하게 "확인됨"으로 바뀌는 순간을 알아야
 * 그때 GPS 시작을 재시도할 수 있다.
 */
export function subscribeToPermissionNotice(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
