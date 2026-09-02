import { isGoogleLoginConfigured } from '@/hooks/use-google-login';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signOut: jest.fn(), signIn: jest.fn() },
  isSuccessResponse: jest.fn(),
  isErrorWithCode: jest.fn(),
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' },
}));

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn() },
  signInWithCredential: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({ auth: {} }));

describe('isGoogleLoginConfigured', () => {
  it('iOS에서 iosClientId가 없으면 미설정으로 본다 (PR #48 2차 리뷰 지적 5번)', () => {
    expect(isGoogleLoginConfigured('ios', 'web-client-id', undefined)).toBe(false);
  });

  it('iOS에서 webClientId/iosClientId가 모두 있으면 설정된 것으로 본다', () => {
    expect(isGoogleLoginConfigured('ios', 'web-client-id', 'ios-client-id')).toBe(true);
  });

  it('안드로이드는 webClientId만 있어도 설정된 것으로 본다', () => {
    expect(isGoogleLoginConfigured('android', 'web-client-id', undefined)).toBe(true);
  });

  it('웹에서는 webClientId가 있어도 미설정으로 본다 — 네이티브 SDK가 웹 스텁만 제공한다 (PR #48 2차 리뷰 지적 6번)', () => {
    expect(isGoogleLoginConfigured('web', 'web-client-id', 'ios-client-id')).toBe(false);
  });

  it('webClientId 자체가 없으면 어떤 플랫폼이든 미설정이다', () => {
    expect(isGoogleLoginConfigured('android', undefined, undefined)).toBe(false);
  });
});
