import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'register-draft';

// 이 초안은 "인증 메일을 받고 링크를 누르는 동안 앱이 종료돼도 다시 입력하지 않게"
// 하려는 것이다. 그 창은 서버 마커 기준 30분이라, 며칠 지난 값이 되살아나는 편이
// 오히려 혼란스럽다. 넉넉히 하루로 제한한다.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RegisterDraft {
  email: string;
  nickname: string;
  nationality: string | null;
}

interface StoredDraft extends RegisterDraft {
  savedAt: number;
}

/** 비밀번호는 일부러 담지 않는다 — 평문으로 기기에 남기지 않기 위해 재입력을 받는다. */
export async function saveRegisterDraft(draft: RegisterDraft): Promise<void> {
  const isEmpty = !draft.email && !draft.nickname && !draft.nationality;
  if (isEmpty) {
    await clearRegisterDraft();
    return;
  }
  const stored: StoredDraft = { ...draft, savedAt: Date.now() };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export async function loadRegisterDraft(): Promise<RegisterDraft | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let stored: StoredDraft;
  try {
    stored = JSON.parse(raw) as StoredDraft;
  } catch {
    // 형식이 깨진 값은 되살릴 방법이 없으니 버린다.
    await clearRegisterDraft();
    return null;
  }

  if (typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > MAX_AGE_MS) {
    await clearRegisterDraft();
    return null;
  }

  return {
    email: typeof stored.email === 'string' ? stored.email : '',
    nickname: typeof stored.nickname === 'string' ? stored.nickname : '',
    nationality: typeof stored.nationality === 'string' ? stored.nationality : null,
  };
}

export async function clearRegisterDraft(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
