import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import LoginScreen from '@/app/(auth)/login';
import { i18n } from '@/i18n';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '@/legal';
import { savePendingConsent } from '@/lib/pending-consent';

/**
 * 약관 동의 시트가 **스크롤 가능한 컨테이너 안에** 그려지는지 본다.
 *
 * 동의 목록은 한때 정적 컨테이너(BottomSheetView)에 들어 있었다. BottomSheetView는 마운트 시
 * 자신을 정적 콘텐츠로 등록해 내부 스크롤을 죽이므로, 넘치는 내용은 스크롤되지 않고 그냥
 * **잘린다.** 위치기반서비스 약관과 연령 확인이 들어오며 카드가 3개에서 5개로 늘었고 snap은
 * 70%라, 작은 화면이나 큰 접근성 폰트에서는 "동의하고 계속하기" 버튼이 시트 밖으로 밀려
 * **가입 자체가 불가능**해질 수 있었다.
 */

// present()/dismiss()만 흉내내고 콘텐츠는 항상 렌더한다 — 시트가 열렸을 때의 트리를 본다.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, ScrollView } = require('react-native');
  const BottomSheetModal = React.forwardRef(
    ({ children }: { children: React.ReactNode }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return <View>{children}</View>;
    },
  );
  BottomSheetModal.displayName = 'BottomSheetModal';

  return {
    BottomSheetModal,
    // 정적 콘텐츠 — 내부 스크롤이 죽는 쪽. 여기 들어가면 테스트가 실패해야 한다.
    BottomSheetView: ({ children }: { children: React.ReactNode }) => (
      <View testID="sheet-static">{children}</View>
    ),
    BottomSheetScrollView: ({ children }: { children: React.ReactNode }) => (
      <ScrollView testID="sheet-scroll">{children}</ScrollView>
    ),
    BottomSheetBackdrop: () => null,
    BottomSheetTextInput: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ fetchQuery: jest.fn(), setQueryData: jest.fn() }),
}));

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({ auth: {} }));
jest.mock('@/api/auth', () => ({ getMe: jest.fn() }));
jest.mock('@/hooks/use-auth-error', () => ({ useHandleAuthError: () => jest.fn() }));
jest.mock('@/hooks/use-social-auth', () => ({ useFinishSocialLogin: () => jest.fn() }));
jest.mock('@/hooks/use-google-login', () => ({
  useGoogleLogin: () => ({ isConfigured: true, promptGoogleLogin: jest.fn() }),
}));

// 실제 구현은 AsyncStorage 네이티브 모듈을 require한다. 여기서는 "넘어갈 때 무엇을
// 넘기는가"만 보면 되므로 저장 자체를 목으로 세운다(보관 규칙은 lib 테스트가 본다).
jest.mock('@/lib/pending-consent', () => ({ savePendingConsent: jest.fn() }));

describe('약관 동의 시트', () => {
  // 로케일을 바꾸지 않고 현재 로케일의 문구를 그대로 조회한다 — 전역 i18n.locale을 건드리면
  // 같은 파일의 다른 테스트에 순서 의존이 생긴다.
  const label = (key: string) => i18n.t(`auth.terms.${key}`);

  beforeEach(() => jest.clearAllMocks());

  it('동의 목록이 스크롤 컨테이너 안에 있다 (넘쳐도 잘리지 않는다)', async () => {
    const { queryByTestId, getByTestId } = await render(<LoginScreen />);

    // 정적 컨테이너에 들어가면 내부 스크롤이 죽어 버튼이 잘린다.
    expect(queryByTestId('sheet-static')).toBeNull();

    const scroll = within(getByTestId('sheet-scroll'));
    // 목록의 마지막 요소 — 잘리면 가장 먼저 화면 밖으로 밀리는 것이 이 버튼이다.
    expect(scroll.getByText(label('continue'))).toBeTruthy();
  });

  it('동의 항목이 문서 수 + 전체동의 + 연령 확인만큼 있다', async () => {
    const { getByTestId } = await render(<LoginScreen />);
    const scroll = within(getByTestId('sheet-scroll'));

    // 항목이 늘어난 것이 위 스크롤이 필요해진 이유다 — 개수가 바뀌면 여백도 다시 봐야 한다.
    // '☐' 접두사는 초기 상태가 전부 미체크라는 뜻이기도 하다(기본 동의 없음).
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(scroll.getByText(`☐ ${label(LEGAL_DOCUMENTS[key].labelKey)}`)).toBeTruthy();
    }
    expect(scroll.getByText(`☐ ${label('ageConfirm')}`)).toBeTruthy();
    expect(scroll.getByText(`☐ ${label('agreeAll')}`)).toBeTruthy();
  });

  /**
   * 동의는 이 화면에서 받는데 가입 API는 다음 화면이 부른다. 넘어가는 순간 **화면에
   * 표시한 문서의 version 그대로** 넘겨야 원장이 사실이 된다 — 다음 화면이 상수에서
   * 다시 만들어내면 시트를 거치지 않은 진입에서도 동의 기록이 생긴다.
   */
  it('전체 동의 후 계속하면 표시한 문서의 version을 그대로 넘긴다', async () => {
    (savePendingConsent as jest.Mock).mockResolvedValue(undefined);
    const { getByTestId } = await render(<LoginScreen />);
    const scroll = within(getByTestId('sheet-scroll'));

    await act(async () => {
      fireEvent.press(scroll.getByText(`☐ ${label('agreeAll')}`));
    });
    await act(async () => {
      fireEvent.press(scroll.getByText(label('continue')));
    });

    expect(savePendingConsent).toHaveBeenCalledWith({
      consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
        document: key,
        version: LEGAL_DOCUMENTS[key].version,
      })),
      ageConfirmed: true,
    });
  });

  /**
   * 버튼에 busy/disabled 표시가 없어(disabled={!allAgreed}뿐) 연타가 그대로 두 번
   * 들어온다. 소셜 경로에서 두 번째 호출이 isAwaitingConsent()를 읽을 때는 첫 번째
   * 호출이 이미 동의 대기 promise를 비운 뒤라 결과가 달라져, Google/Apple 유저가
   * 이메일 가입 화면(register) 위에 얹히는 사고로 이어졌다(PR #59 리뷰 지적).
   */
  it('연속으로 두 번 눌러도 한 번만 처리한다 (연타 방지)', async () => {
    (savePendingConsent as jest.Mock).mockResolvedValue(undefined);
    const { getByTestId } = await render(<LoginScreen />);
    const scroll = within(getByTestId('sheet-scroll'));

    await act(async () => {
      fireEvent.press(scroll.getByText(`☐ ${label('agreeAll')}`));
    });

    await act(async () => {
      fireEvent.press(scroll.getByText(label('continue')));
      fireEvent.press(scroll.getByText(label('continue')));
    });

    expect(savePendingConsent).toHaveBeenCalledTimes(1);
  });

  it('동의가 덜 된 상태에서는 아무것도 넘기지 않는다', async () => {
    const { getByTestId } = await render(<LoginScreen />);
    const scroll = within(getByTestId('sheet-scroll'));

    // 연령 확인만 빼고 문서에는 전부 동의한다 — 버튼이 비활성이라 눌러도 반응이 없어야 한다.
    for (const key of LEGAL_DOCUMENT_KEYS) {
      await act(async () => {
        fireEvent.press(scroll.getByText(`☐ ${label(LEGAL_DOCUMENTS[key].labelKey)}`));
      });
    }
    await act(async () => {
      fireEvent.press(scroll.getByText(label('continue')));
    });

    expect(savePendingConsent).not.toHaveBeenCalled();
  });
});
