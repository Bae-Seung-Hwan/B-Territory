import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useRegistrationFlow } from '@/hooks/use-registration-flow';
import { useSendFirebaseVerificationEmail } from '@/hooks/use-firebase-email-verification';
import { auth } from '@/lib/firebase';
import { clearRegisterDraft } from '@/lib/register-draft';
import {
  MissingConsentError,
  clearPendingConsent,
  loadPendingConsent,
} from '@/lib/pending-consent';
import {
  LEGAL_DOCUMENT_KEYS,
  buildConsentSnapshot,
  type ConsentSnapshot,
  type LegalDocumentKey,
} from '@/legal';
import * as authApi from '@/api/auth';

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));

jest.mock('@/lib/register-draft', () => ({ clearRegisterDraft: jest.fn() }));

// 보관/만료 규칙은 lib 테스트가 본다. 여기서 볼 것은 "가입 직전에 읽고, 없으면 어떻게
// 되는가"라 읽기·지우기만 목으로 세우고 MissingConsentError는 실물을 쓴다.
jest.mock('@/lib/pending-consent', () => ({
  ...jest.requireActual('@/lib/pending-consent'),
  loadPendingConsent: jest.fn(),
  clearPendingConsent: jest.fn(),
}));

jest.mock('@/hooks/use-firebase-email-verification', () => ({
  useSendFirebaseVerificationEmail: jest.fn(),
}));

jest.mock('@/api/auth', () => ({ registerUser: jest.fn(), getMe: jest.fn() }));

// use-registration-flow.ts -> use-auth.ts -> AuthProvider.tsx -> visit-checkin.ts가
// 실제 AsyncStorage 네이티브 모듈을 require한다(PR #53 리뷰 지적 6번 대응으로 추가된
// import). 이 테스트는 AuthProvider의 컴포넌트 로직을 렌더하지 않지만, 모듈을
// require하는 시점에 그 체인이 그대로 실행돼 목이 없으면 네이티브 모듈 에러로 깨진다.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockedAuth = auth as unknown as { currentUser: unknown };
const mockedCreateUser = createUserWithEmailAndPassword as jest.Mock;
const mockedSignIn = signInWithEmailAndPassword as jest.Mock;
const mockedSignOut = signOut as jest.Mock;
const mockedUseSendVerification = useSendFirebaseVerificationEmail as jest.Mock;

const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };

// 문서 목록에서 파생시킨다 — 손으로 적으면 문서가 늘어도 이 테스트만 옛 목록으로 통과한다.
const consentSnapshot = buildConsentSnapshot(
  Object.fromEntries(LEGAL_DOCUMENT_KEYS.map((key) => [key, true])) as Record<
    LegalDocumentKey,
    boolean
  >,
  true,
) as ConsentSnapshot;

function createUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'a@b.com',
    emailVerified: false,
    reload: jest.fn().mockResolvedValue(undefined),
    getIdToken: jest.fn().mockResolvedValue('token'),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function renderFlow(onRegistered = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = await renderHook(() => useRegistrationFlow({ onRegistered }), {
    wrapper: createWrapper(queryClient),
  });
  return { ...rendered, onRegistered };
}

beforeEach(() => {
  mockedAuth.currentUser = null;
  (loadPendingConsent as jest.Mock).mockResolvedValue(consentSnapshot);
  mockedSignOut.mockResolvedValue(undefined);
  mockedUseSendVerification.mockReturnValue({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    isSending: false,
    hasSent: false,
    cooldown: 0,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('콜드스타트 감지', () => {
  it('마운트 시점에 이미 Firebase 세션이 있으면 첫 렌더부터 인증 대기 단계다', async () => {
    mockedAuth.currentUser = createUser({ emailVerified: false });

    const { result } = await renderFlow();

    expect(result.current.step).toBe('awaitingVerification');
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('세션이 없으면 폼 단계로 시작한다', async () => {
    const { result } = await renderFlow();
    expect(result.current.step).toBe('form');
  });
});

describe('신규 가입', () => {
  it('계정 생성 후 미인증이면 인증 메일을 보내고 대기 단계로 전환한다', async () => {
    const user = createUser({ emailVerified: false });
    mockedCreateUser.mockResolvedValue({ user });
    const sendVerificationEmail = jest.fn().mockResolvedValue(true);
    mockedUseSendVerification.mockReturnValue({
      sendVerificationEmail,
      isSending: false,
      hasSent: false,
      cooldown: 0,
    });

    const { result } = await renderFlow();

    await act(async () => {
      await result.current.submit('a@b.com', 'pw123456', 'nick', 'KR');
    });

    expect(mockedCreateUser).toHaveBeenCalledWith(mockedAuth, 'a@b.com', 'pw123456');
    expect(sendVerificationEmail).toHaveBeenCalledWith(user);
    expect(result.current.step).toBe('awaitingVerification');
    expect(authApi.registerUser as jest.Mock).not.toHaveBeenCalled();
  });

  it('발송이 실패해도 예외를 던지지 않고 대기 단계로 전환된다(가입 실패 알럿과 모순되지 않는다)', async () => {
    const user = createUser({ emailVerified: false });
    mockedCreateUser.mockResolvedValue({ user });
    const sendVerificationEmail = jest.fn().mockRejectedValue(new Error('send failed'));
    mockedUseSendVerification.mockReturnValue({
      sendVerificationEmail,
      isSending: false,
      hasSent: false,
      cooldown: 0,
    });

    const { result } = await renderFlow();

    let submitResult;
    await act(async () => {
      submitResult = await result.current.submit('a@b.com', 'pw123456', 'nick', 'KR');
    });

    expect(submitResult).toBe('verificationSendFailed');
    expect(result.current.step).toBe('awaitingVerification');
  });
});

describe('이어서 가입 (auth/email-already-in-use)', () => {
  it('이미 인증된 유령 계정이면 재발송 없이 곧장 가입을 완료한다', async () => {
    mockedCreateUser.mockRejectedValue({ code: 'auth/email-already-in-use' });
    const user = createUser({ emailVerified: true });
    mockedSignIn.mockResolvedValue({ user });
    (authApi.registerUser as jest.Mock).mockResolvedValue(profile);
    const sendVerificationEmail = jest.fn();
    mockedUseSendVerification.mockReturnValue({
      sendVerificationEmail,
      isSending: false,
      hasSent: false,
      cooldown: 0,
    });
    const onRegistered = jest.fn();

    const { result } = await renderFlow(onRegistered);

    await act(async () => {
      await result.current.submit('a@b.com', 'pw123456', 'nick', 'KR');
    });

    expect(mockedSignIn).toHaveBeenCalledWith(mockedAuth, 'a@b.com', 'pw123456');
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect((authApi.registerUser as jest.Mock).mock.calls[0][0]).toEqual({
      nickname: 'nick',
      nationality: 'KR',
      consents: consentSnapshot.consents,
      ageConfirmed: true,
    });
    expect(clearRegisterDraft).toHaveBeenCalled();
    expect(clearPendingConsent).toHaveBeenCalled();
    expect(onRegistered).toHaveBeenCalled();
  });

  it('아직 미인증이면 재발송 후 대기 단계로 전환한다', async () => {
    mockedCreateUser.mockRejectedValue({ code: 'auth/email-already-in-use' });
    const user = createUser({ emailVerified: false });
    mockedSignIn.mockResolvedValue({ user });
    const sendVerificationEmail = jest.fn().mockResolvedValue(true);
    mockedUseSendVerification.mockReturnValue({
      sendVerificationEmail,
      isSending: false,
      hasSent: false,
      cooldown: 0,
    });

    const { result } = await renderFlow();

    await act(async () => {
      await result.current.submit('a@b.com', 'pw123456', 'nick', 'KR');
    });

    expect(sendVerificationEmail).toHaveBeenCalledWith(user);
    expect(result.current.step).toBe('awaitingVerification');
  });
});

describe('인증 완료 확인', () => {
  it('아직 인증되지 않았으면 register를 호출하지 않고 not-verified를 반환한다', async () => {
    const user = createUser({ emailVerified: false });
    mockedAuth.currentUser = user;

    const { result } = await renderFlow();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.confirmVerification('nick', 'KR');
    });

    expect(user.reload).toHaveBeenCalled();
    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(authApi.registerUser as jest.Mock).not.toHaveBeenCalled();
    expect(outcome).toBe('not-verified');
  });

  it('세션이 없으면 폼 단계로 되돌리고 no-session을 반환한다', async () => {
    mockedAuth.currentUser = null;
    const { result } = await renderFlow();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.confirmVerification('nick', 'KR');
    });

    expect(outcome).toBe('no-session');
    expect(result.current.step).toBe('form');
  });

  it('reload 후 인증됐으면 getIdToken(true)을 registerUser보다 먼저 완료시킨 뒤 가입을 마친다', async () => {
    const callOrder: string[] = [];
    const user = createUser({
      emailVerified: false,
      reload: jest.fn().mockImplementation(async () => {
        user.emailVerified = true;
      }),
      getIdToken: jest.fn().mockImplementation(async () => {
        callOrder.push('getIdToken');
        return 'fresh-token';
      }),
    });
    mockedAuth.currentUser = user;
    (authApi.registerUser as jest.Mock).mockImplementation(async () => {
      callOrder.push('registerUser');
      return profile;
    });
    const onRegistered = jest.fn();

    const { result } = await renderFlow(onRegistered);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.confirmVerification('nick', 'KR');
    });

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(callOrder).toEqual(['getIdToken', 'registerUser']);
    expect(outcome).toBe('registered');
    expect(onRegistered).toHaveBeenCalled();
  });
});

/** 이번 시도로 계정을 만들고 인증까지 끝난 상태(= 롤백 판정의 대상)를 만든다. */
async function submitFreshAccount(result: Awaited<ReturnType<typeof renderFlow>>['result']) {
  const user = createUser({ emailVerified: false });
  mockedCreateUser.mockResolvedValue({ user });
  await act(async () => {
    await result.current.submit('a@b.com', 'pw123456', 'nick', 'KR');
  });
  // 인증 완료 시점에 auth.currentUser가 그 user를 가리키도록 맞춘다
  user.emailVerified = true;
  mockedAuth.currentUser = user;
  return user;
}

describe('동의 스냅샷', () => {
  /**
   * 이 테스트가 지키는 것은 원장이 아니라 **이용자의 계정**이다. 동의 없이 보내면 서버가
   * CONSENT_INCOMPLETE로 400을 주는데, 그 400은 롤백 판정(409 아닌 4xx)에 걸려 이메일
   * 인증까지 마친 Firebase 계정을 지운다. 재시도해도 같은 자리에서 같은 일이 반복된다.
   */
  it('보관된 동의가 없으면 register를 부르지 않고 Firebase 계정도 지우지 않는다', async () => {
    (loadPendingConsent as jest.Mock).mockResolvedValue(null);
    const { result } = await renderFlow();
    const user = await submitFreshAccount(result);

    await act(async () => {
      await expect(result.current.confirmVerification('nick', 'KR')).rejects.toBeInstanceOf(
        MissingConsentError,
      );
    });

    expect(authApi.registerUser as jest.Mock).not.toHaveBeenCalled();
    expect(user.delete).not.toHaveBeenCalled();
  });

  it('보관된 동의를 그대로 실어 보낸다 — 상수에서 다시 만들지 않는다', async () => {
    // 그 사이 문서가 개정돼도 이용자가 읽고 동의한 것은 이 판본이다.
    const olderSnapshot: ConsentSnapshot = {
      consents: consentSnapshot.consents.map((item) => ({ ...item, version: '2026-01-01' })),
      ageConfirmed: true,
    };
    (loadPendingConsent as jest.Mock).mockResolvedValue(olderSnapshot);
    (authApi.registerUser as jest.Mock).mockResolvedValue(profile);

    const { result } = await renderFlow();
    await submitFreshAccount(result);

    await act(async () => {
      await result.current.confirmVerification('nick', 'KR');
    });

    expect((authApi.registerUser as jest.Mock).mock.calls[0][0]).toEqual({
      nickname: 'nick',
      nationality: 'KR',
      consents: olderSnapshot.consents,
      ageConfirmed: true,
    });
  });
});

describe('롤백 불변식', () => {

  it('이번 시도로 만든 계정 + 4xx(409 제외) 거부 → 롤백한다', async () => {
    const { result } = await renderFlow();
    const user = await submitFreshAccount(result);
    (authApi.registerUser as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400 },
    });

    await act(async () => {
      await expect(result.current.confirmVerification('nick', 'KR')).rejects.toBeTruthy();
    });

    expect(user.delete).toHaveBeenCalled();
  });

  it('이번 시도로 만든 계정 + 409(이미 가입됨) → 롤백하지 않는다', async () => {
    const { result } = await renderFlow();
    const user = await submitFreshAccount(result);
    (authApi.registerUser as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
    });

    await act(async () => {
      await expect(result.current.confirmVerification('nick', 'KR')).rejects.toBeTruthy();
    });

    expect(user.delete).not.toHaveBeenCalled();
  });

  it('이번 시도로 만든 계정 + 네트워크 오류(response 없음) → 롤백하지 않는다', async () => {
    const { result } = await renderFlow();
    const user = await submitFreshAccount(result);
    (authApi.registerUser as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: undefined,
    });

    await act(async () => {
      await expect(result.current.confirmVerification('nick', 'KR')).rejects.toBeTruthy();
    });

    expect(user.delete).not.toHaveBeenCalled();
  });

  it('이어서-가입(콜드스타트/signIn) 경로는 4xx여도 롤백하지 않는다', async () => {
    // 이번 컴포넌트 인스턴스가 계정을 만들지 않았다 — 마운트 시점부터 세션이 있던 콜드스타트 케이스.
    const user = createUser({ emailVerified: true });
    mockedAuth.currentUser = user;
    (authApi.registerUser as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400 },
    });

    const { result } = await renderFlow();

    await act(async () => {
      await expect(result.current.confirmVerification('nick', 'KR')).rejects.toBeTruthy();
    });

    expect(user.delete).not.toHaveBeenCalled();
  });
});

describe('다른 이메일로 가입', () => {
  it('대기 중인 미인증 계정을 지우고 초안을 비운 뒤 폼 단계로 되돌린다', async () => {
    const user = createUser({ emailVerified: false });
    mockedAuth.currentUser = user;

    const { result } = await renderFlow();
    expect(result.current.step).toBe('awaitingVerification');

    await act(async () => {
      await result.current.changeEmail();
    });

    expect(user.delete).toHaveBeenCalled();
    expect(clearRegisterDraft).toHaveBeenCalled();
    expect(result.current.step).toBe('form');
  });

  it('delete가 막히면(requires-recent-login 등) signOut으로 대신 세션을 정리한다', async () => {
    const user = createUser({
      emailVerified: false,
      delete: jest.fn().mockRejectedValue({ code: 'auth/requires-recent-login' }),
    });
    mockedAuth.currentUser = user;

    const { result } = await renderFlow();

    await act(async () => {
      await result.current.changeEmail();
    });

    expect(user.delete).toHaveBeenCalled();
    expect(mockedSignOut).toHaveBeenCalledWith(mockedAuth);
    expect(result.current.step).toBe('form');
  });
});
