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

  function renderButton(overrides: {
    requestConsent?: jest.Mock;
    beginSocialAuth?: jest.Mock;
    endSocialAuth?: jest.Mock;
  } = {}) {
    return render(
      <AppleSignInButton
        requestConsent={overrides.requestConsent ?? jest.fn()}
        beginSocialAuth={overrides.beginSocialAuth ?? jest.fn().mockReturnValue(true)}
        endSocialAuth={overrides.endSocialAuth ?? jest.fn()}
      />,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseHandleAuthError.mockReturnValue(handleAuthError);
    mockedUseFinishSocialLogin.mockReturnValue(finishSocialLogin);
    mockedSignInWithCredential.mockResolvedValue(undefined);
    mockedSignInAsync.mockResolvedValue({ identityToken: 'id-token' });
  });

  it('Android에서는 아무것도 렌더링하지 않는다', async () => {
    Platform.OS = 'android';
    const { queryByTestId } = await renderButton();

    expect(queryByTestId('apple-button')).toBeNull();
  });

  it('iOS라도 기기에서 Apple 로그인을 지원하지 않으면 렌더링하지 않는다', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(false);
    const { queryByTestId } = await renderButton();

    await waitFor(() => expect(mockedIsAvailable).toHaveBeenCalled());
    expect(queryByTestId('apple-button')).toBeNull();
  });

  it('동의를 먼저 묻지 않고 곧장 Apple 로그인을 시작한다 (동의는 신규 유저로 판명된 뒤 useFinishSocialLogin 안에서 처리)', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(true);
    const requestConsent = jest.fn().mockResolvedValue(true);
    const { findByTestId } = await renderButton({ requestConsent });

    const button = await findByTestId('apple-button');
    await fireEvent.press(button);

    await waitFor(() => expect(finishSocialLogin).toHaveBeenCalledTimes(1));
    expect(requestConsent).not.toHaveBeenCalled();
    expect(mockedSignInAsync).toHaveBeenCalledTimes(1);
    expect(mockedSignInWithCredential).toHaveBeenCalledWith({}, 'fake-firebase-credential');
    expect(handleAuthError).not.toHaveBeenCalled();
  });

  it('requestConsent를 그대로 useFinishSocialLogin에 넘긴다', async () => {
    Platform.OS = 'ios';
    mockedIsAvailable.mockResolvedValue(true);
    const requestConsent = jest.fn().mockResolvedValue(true);
    await renderButton({ requestConsent });

    expect(mockedUseFinishSocialLogin).toHaveBeenCalledWith(requestConsent);
  });

  describe('다른 소셜 로그인이 이미 진행 중일 때(Google/Apple 교차 탭)', () => {
    it('beginSocialAuth가 false를 반환하면 Apple 로그인을 시작하지 않는다', async () => {
      Platform.OS = 'ios';
      mockedIsAvailable.mockResolvedValue(true);
      const beginSocialAuth = jest.fn().mockReturnValue(false);
      const endSocialAuth = jest.fn();
      const { findByTestId } = await renderButton({ beginSocialAuth, endSocialAuth });

      const button = await findByTestId('apple-button');
      await fireEvent.press(button);

      expect(mockedSignInAsync).not.toHaveBeenCalled();
      expect(finishSocialLogin).not.toHaveBeenCalled();
      expect(endSocialAuth).not.toHaveBeenCalled();
    });

    it('성공하면 endSocialAuth로 가드를 풀어준다', async () => {
      Platform.OS = 'ios';
      mockedIsAvailable.mockResolvedValue(true);
      const endSocialAuth = jest.fn();
      const { findByTestId } = await renderButton({ endSocialAuth });

      const button = await findByTestId('apple-button');
      await fireEvent.press(button);

      await waitFor(() => expect(finishSocialLogin).toHaveBeenCalledTimes(1));
      expect(endSocialAuth).toHaveBeenCalledTimes(1);
    });

    it('취소되거나 실패해도 endSocialAuth로 가드를 풀어준다', async () => {
      Platform.OS = 'ios';
      mockedIsAvailable.mockResolvedValue(true);
      mockedSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
      const endSocialAuth = jest.fn();
      const { findByTestId } = await renderButton({ endSocialAuth });

      const button = await findByTestId('apple-button');
      await fireEvent.press(button);

      await waitFor(() => expect(endSocialAuth).toHaveBeenCalledTimes(1));
      expect(handleAuthError).not.toHaveBeenCalled();
    });
  });
});
