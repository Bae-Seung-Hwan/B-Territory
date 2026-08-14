import { renderHook, act } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { signInWithCredential } from 'firebase/auth';
import { useGoogleLogin } from '@/hooks/use-google-login';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signOut: jest.fn(),
    signIn: jest.fn(),
  },
  isSuccessResponse: (response: unknown) =>
    !!response && typeof response === 'object' && (response as { type?: string }).type === 'success',
  isErrorWithCode: (err: unknown) => !!err && typeof err === 'object' && 'code' in err,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' },
}));

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn(() => 'fake-credential') },
  signInWithCredential: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({ auth: {} }));

const mockedSignIn = GoogleSignin.signIn as jest.Mock;
const mockedSignOut = GoogleSignin.signOut as jest.Mock;
const mockedHasPlayServices = GoogleSignin.hasPlayServices as jest.Mock;
const mockedSignInWithCredential = signInWithCredential as jest.Mock;

const successResponse = (idToken: string | null) => ({
  type: 'success',
  data: { idToken },
});

describe('useGoogleLogin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHasPlayServices.mockResolvedValue(true);
    mockedSignOut.mockResolvedValue(undefined);
    mockedSignInWithCredential.mockResolvedValue(undefined);
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-id';
  });

  it('signIn() 전에 signOut()을 호출해 매번 계정 선택 화면이 뜨게 한다', async () => {
    mockedSignIn.mockResolvedValue(successResponse('id-token'));
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = await renderHook(() => useGoogleLogin({ onSuccess, onError }));

    await act(async () => {
      await result.current.promptGoogleLogin();
    });

    const signOutOrder = mockedSignOut.mock.invocationCallOrder[0];
    const signInOrder = mockedSignIn.mock.invocationCallOrder[0];
    expect(signOutOrder).toBeLessThan(signInOrder);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('idToken이 없으면 onSuccess를 호출하지 않고 onError로 알린다', async () => {
    mockedSignIn.mockResolvedValue(successResponse(null));
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = await renderHook(() => useGoogleLogin({ onSuccess, onError }));

    await act(async () => {
      await result.current.promptGoogleLogin();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('사용자가 취소하면(type이 success가 아님) 조용히 끝나고 onError를 호출하지 않는다', async () => {
    mockedSignIn.mockResolvedValue({ type: 'cancelled' });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = await renderHook(() => useGoogleLogin({ onSuccess, onError }));

    await act(async () => {
      await result.current.promptGoogleLogin();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('SIGN_IN_CANCELLED 에러는 무해한 취소로 보고 onError를 호출하지 않는다', async () => {
    mockedSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = await renderHook(() => useGoogleLogin({ onSuccess, onError }));

    await act(async () => {
      await result.current.promptGoogleLogin();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it('그 외 에러는 onError로 전달한다', async () => {
    const err = new Error('DEVELOPER_ERROR');
    mockedSignIn.mockRejectedValue(err);
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = await renderHook(() => useGoogleLogin({ onSuccess, onError }));

    await act(async () => {
      await result.current.promptGoogleLogin();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(err);
  });
});
