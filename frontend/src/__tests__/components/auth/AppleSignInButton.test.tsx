import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithCredential } from 'firebase/auth';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useFinishSocialLogin } from '@/hooks/use-social-auth';

jest.mock('expo-apple-authentication', () => {
  const { TouchableOpacity, Text } = require('react-native');
  return {
    isAvailableAsync: jest.fn(),
    signInAsync: jest.fn(),
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => (
      <TouchableOpacity testID="apple-button" onPress={onPress}>
        <Text>Apple로 계속하기</Text>
      </TouchableOpacity>
    ),
    AppleAuthenticationButtonType: { CONTINUE: 'continue' },
    AppleAuthenticationButtonStyle: { WHITE: 'white' },
    AppleAuthenticationScope: { FULL_NAME: 'full_name', EMAIL: 'email' },
  };
});

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'raw-nonce'),
  digestStringAsync: jest.fn(() => Promise.resolve('hashed-nonce')),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

jest.mock('firebase/auth', () => ({
  OAuthProvider: jest.fn().mockImplementation(() => ({
    credential: jest.fn(() => 'fake-firebase-credential'),
  })),
  signInWithCredential: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({ auth: {} }));
jest.mock('@/hooks/use-auth-error', () => ({ useHandleAuthError: jest.fn() }));
jest.mock('@/hooks/use-social-auth', () => ({ useFinishSocialLogin: jest.fn() }));

const mockedIsAvailable = AppleAuthentication.isAvailableAsync as jest.Mock;
const mockedSignInAsync = AppleAuthentication.signInAsync as jest.Mock;
const mockedSignInWithCredential = signInWithCredential as jest.Mock;
const mockedUseHandleAuthError = useHandleAuthError as jest.Mock;
const mockedUseFinishSocialLogin = useFinishSocialLogin as jest.Mock;

describe('AppleSignInButton', () => {
  const handleAuthError = jest.fn();
  const finishSocialLogin = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseHandleAuthError.mockReturnValue(handleAuthError);
    mockedUseFinishSocialLogin.mockReturnValue(finishSocialLogin);
    mockedSignInWithCredential.mockResolvedValue(undefined);
    mockedSignInAsync.mockResolvedValue({ identityToken: 'id-token' });
  });

  it('Android에서는 아무것도 렌더링하지 않는다', async () => {
    Platform.OS = 'android';
    const { queryByTestId } = await render(
      <AppleSignInButton requestConsent={jest.fn()} />,
    );

    expect(queryByTestId('apple-button')).toBeNull();
  });

  it('iOS라도 기기에서 Apple 로그인을 지원하지 않으면 렌더링하지 않는다', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(false);
    const { queryByTestId } = await render(
      <AppleSignInButton requestConsent={jest.fn()} />,
    );

    await waitFor(() => expect(mockedIsAvailable).toHaveBeenCalled());
    expect(queryByTestId('apple-button')).toBeNull();
  });

  it('동의를 거부하면(requestConsent가 false) Apple 로그인을 시작하지 않는다', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(true);
    const requestConsent = jest.fn().mockResolvedValue(false);
    const { findByTestId } = await render(<AppleSignInButton requestConsent={requestConsent} />);

    const button = await findByTestId('apple-button');
    await fireEvent.press(button);

    expect(requestConsent).toHaveBeenCalledTimes(1);
    expect(mockedSignInAsync).not.toHaveBeenCalled();
    expect(finishSocialLogin).not.toHaveBeenCalled();
  });

  it('동의하면(requestConsent가 true) Apple 로그인을 진행하고 성공 시 finishSocialLogin을 호출한다', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(true);
    const requestConsent = jest.fn().mockResolvedValue(true);
    const { findByTestId } = await render(<AppleSignInButton requestConsent={requestConsent} />);

    const button = await findByTestId('apple-button');
    await fireEvent.press(button);

    await waitFor(() => expect(finishSocialLogin).toHaveBeenCalledTimes(1));
    expect(mockedSignInAsync).toHaveBeenCalledTimes(1);
    expect(mockedSignInWithCredential).toHaveBeenCalledWith({}, 'fake-firebase-credential');
    expect(handleAuthError).not.toHaveBeenCalled();
  });
});
