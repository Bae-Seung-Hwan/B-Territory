import AsyncStorage from '@react-native-async-storage/async-storage';
import { LEGAL_DOCUMENT_KEYS, type ConsentSnapshot, type LegalDocumentKey } from '@/legal';

const STORAGE_KEY = 'pending-consent';

// register-draft와 같은 창을 쓴다 — 둘 다 "인증 메일 링크를 누르는 동안 앱이 종료돼도
// 가입을 이어갈 수 있게" 하려는 것이고, 넉넉히 하루로 제한하는 이유도 같다.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredSnapshot extends ConsentSnapshot {
  savedAt: number;
}

/**
 * 동의 화면(login.tsx의 약관 시트)과 가입 API 호출(register.tsx / complete-profile.tsx)
 * 사이를 건너는 동의 스냅샷.
 *
 * 두 화면이 갈라져 있어 상태로는 건널 수 없다 — 이메일 경로는 시트에서 `register`로
 * push하고, 소셜 경로는 `complete-profile`로 replace한다. 게다가 이메일 경로는 인증 메일을
 * 확인하러 앱을 벗어났다 **콜드스타트로 돌아오는** 것이 정상 흐름이라(register-draft가
 * 존재하는 이유가 그것이다) 메모리에 든 값은 그 시점에 이미 없다.
 *
 * 제출 시점에 `LEGAL_DOCUMENTS`에서 다시 파생시키는 방법도 있지만 쓰지 않는다 — 그러면
 * 시트를 거치지 않고 도착한 진입(딥링크, 세션만 남은 콜드스타트)에서도 동의 기록이
 * 만들어진다. **받은 적 없는 동의를 원장에 남기는 것**이라, 이 원장이 없애려던 상태
 * (동의했다는 증거가 없는 계정)를 증거가 거짓인 계정으로 바꿀 뿐이다.
 */
export async function savePendingConsent(snapshot: ConsentSnapshot): Promise<void> {
  const stored: StoredSnapshot = { ...snapshot, savedAt: Date.now() };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/**
 * 보관된 동의를 돌려준다. 되살릴 수 없거나 **지금 앱이 요구하는 문서 목록과 어긋나면**
 * `null`이다.
 *
 * 목록 대조가 핵심이다. 서버는 필수 항목을 자기가 정하므로(`CLIENT_CONSENT_DOCUMENTS`),
 * 문서가 하나 늘어난 버전으로 앱이 업데이트된 뒤 옛 스냅샷을 그대로 보내면 누락으로 400이
 * 나고, 그 400은 use-registration-flow.ts의 롤백 판정(409 아닌 4xx)에 걸려 **이메일 인증까지
 * 마친 Firebase 계정을 지운다.** 여기서 걸러 동의 시트로 되돌리는 편이 낫다.
 *
 * 반면 `version`이 지금 문서와 다른 것은 정상으로 본다 — 그 사이 문서가 개정됐다면
 * 이용자가 실제로 읽고 동의한 것은 옛 판본이고, 원장에는 그 값이 남아야 사실이다.
 */
export async function loadPendingConsent(): Promise<ConsentSnapshot | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let stored: StoredSnapshot;
  try {
    stored = JSON.parse(raw) as StoredSnapshot;
  } catch {
    // 형식이 깨진 값은 되살릴 방법이 없으니 버린다.
    await clearPendingConsent();
    return null;
  }

  if (typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > MAX_AGE_MS) {
    await clearPendingConsent();
    return null;
  }

  if (stored.ageConfirmed !== true || !Array.isArray(stored.consents)) {
    await clearPendingConsent();
    return null;
  }

  const byDocument = new Map<string, string>();
  for (const item of stored.consents) {
    if (typeof item?.document !== 'string' || typeof item?.version !== 'string') {
      await clearPendingConsent();
      return null;
    }
    byDocument.set(item.document, item.version);
  }

  // 지금 앱이 아는 문서와 정확히 일치해야 한다. 모자라면(문서 추가) 서버가 누락으로,
  // 남으면(문서 삭제) 서버가 알 수 없는 항목으로 거절한다.
  const covers =
    byDocument.size === LEGAL_DOCUMENT_KEYS.length &&
    LEGAL_DOCUMENT_KEYS.every((key) => byDocument.has(key));
  if (!covers) {
    await clearPendingConsent();
    return null;
  }

  return {
    consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
      document: key as LegalDocumentKey,
      version: byDocument.get(key) as string,
    })),
    ageConfirmed: true,
  };
}

export async function clearPendingConsent(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * 보관된 동의가 없어 가입을 진행할 수 없는 상태. 호출부가 "동의 시트로 되돌린다"를
 * 네트워크 실패나 서버 거절과 구분해 처리하도록 별도 타입으로 던진다.
 */
export class MissingConsentError extends Error {
  constructor() {
    super('No stored consent for registration');
    this.name = 'MissingConsentError';
  }
}
