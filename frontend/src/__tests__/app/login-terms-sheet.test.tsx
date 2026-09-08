import React from 'react';
import { render, within } from '@testing-library/react-native';
import LoginScreen from '@/app/(auth)/login';
import { i18n } from '@/i18n';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '@/legal';

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

describe('약관 동의 시트', () => {
  // 로케일을 바꾸지 않고 현재 로케일의 문구를 그대로 조회한다 — 전역 i18n.locale을 건드리면
  // 같은 파일의 다른 테스트에 순서 의존이 생긴다.
  const label = (key: string) => i18n.t(`auth.terms.${key}`);

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
});
