import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useGoogleLogin } from '@/hooks/use-google-login';
import { useFinishSocialLogin } from '@/hooks/use-social-auth';
import { useSocialLoginConsent } from '@/hooks/use-social-login-consent';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  buildConsentSnapshot,
  legalBody,
  type LegalDocumentKey,
} from '@/legal';
import { savePendingConsent } from '@/lib/pending-consent';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

const NO_AGREEMENTS = Object.fromEntries(LEGAL_DOCUMENT_KEYS.map((key) => [key, false])) as Record<
  LegalDocumentKey,
  boolean
>;

const ALL_AGREEMENTS = Object.fromEntries(LEGAL_DOCUMENT_KEYS.map((key) => [key, true])) as Record<
  LegalDocumentKey,
  boolean
>;

export default function LoginScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, locale } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const termsSheetRef = useRef<BottomSheetModal>(null);
  // 문서별 동의를 개별 state가 아니라 하나의 맵으로 든다 — 위치기반서비스 약관이 세 번째
  // 항목으로 들어오면서(위치정보법상 개인정보처리방침으로 갈음할 수 없다), 항목이 늘 때마다
  // useState와 allAgreed를 따로 고쳐야 하는 구조였다. 하나를 빠뜨리면 동의를 받지 않은 문서가
  // 조용히 생긴다.
  // 현재는 이 맵을 서버로 보내지 않는다 — registerUser 페이로드는 {nickname, nationality}뿐이고
  // 동의 여부·버전은 클라이언트에만 남는다. 서버 측 저장은 PR #56(`user_consents` 원장,
  // `POST /api/auth/register`에 `consents[]`·`ageConfirmed` 추가)이 구현 중이다 — 이 PR이
  // 머지되면 여기서 `agreed`/`agreeAge`를 그 페이로드 형태로 변환해 보내도록 이 파일도 고칠 것.
  // `ConsentDocument`(service/privacy/location) 값은 LegalDocumentKey와 문자열이 같아야 한다.
  const [agreed, setAgreed] = useState<Record<LegalDocumentKey, boolean>>(NO_AGREEMENTS);
  // 만 14세 미만은 법정대리인 동의가 필요해 가입 자체를 받지 않는다(docs/compliance.md 2.5에서
  // 만 14세로 확정). 생년월일을 받지 않는 것은 의도된 선택이다 — 확인만 하면 되는데 생년월일을
  // 받으면 수집 항목이 늘어 최소수집 원칙과 어긋난다.
  const [agreeAge, setAgreeAge] = useState(false);
  const [termsView, setTermsView] = useState<'list' | LegalDocumentKey>('list');
  const allAgreed = LEGAL_DOCUMENT_KEYS.every((key) => agreed[key]) && agreeAge;

  // 아래 useSocialLoginConsent가 렌더 중에 이 함수를 참조하므로 훅 호출보다 먼저 선언한다.
  const openTermsSheet = () => {
    // 시트를 열 때마다 동의를 전부 되돌린다 — 이전에 열었다 닫은 체크가 남아 있으면
    // 사용자가 읽지 않은 문서에 이미 동의한 상태로 시작한다.
    setAgreed(NO_AGREEMENTS);
    setAgreeAge(false);
    setTermsView('list');
    termsSheetRef.current?.present();
  };

  const {
    requestConsent: requestSocialConsent,
    resolveConsent,
    isAwaitingConsent,
  } = useSocialLoginConsent({ onRequest: openTermsSheet });

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const finishLogin = async () => {
    const profile = await queryClient.fetchQuery({ queryKey: queryKeys.auth.me, queryFn: getMe });

    if (profile === null) {
      // Firebase 계정은 있지만 백엔드 프로필이 없음 (가입 미완료). 가입 화면으로
      // 바로 넘기면 "왜 다시 가입하라는지" 혼란을 주므로, 이메일/비밀번호를
      // 다시 확인하도록 안내한다. 세션을 남겨두면 이후 모든 요청에 토큰이 붙고
      // 다음 부팅 때 "세션은 유효한데 프로필은 없는" 상태를 다시 만나므로 정리한다.
      await signOut(auth);
      Alert.alert(t('auth.errors.title'), t('auth.errors.invalidCredential'));
      return;
    }

    // 프로필은 queryKeys.auth.me 캐시에 이미 담겼다. useAuth()가 그 캐시에서
    // 인증 상태를 파생시키므로 여기서 따로 스토어에 복사하지 않는다.
    // (main)은 가드되어 있어 인증 상태가 리렌더에 반영되기 전까진 열리지 않으므로,
    // 항상 열려있는 "/"로 보내 index가 판단하게 한다.
    router.replace('/');
  };

  const handleAuthError = useHandleAuthError();
  const finishSocialLogin = useFinishSocialLogin(requestSocialConsent);

  const handleLogin = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await finishLogin();
    } catch (err) {
      handleAuthError(err, 'auth.errors.loginFailed');
    } finally {
      setLoading(false);
    }
  };

  // Google/Apple 버튼을 동시에(또는 한쪽 present 애니메이션 중 다른 쪽을) 누르면 양쪽
  // 네이티브 로그인 플로우가 함께 시작돼 signInWithCredential이 두 번 성공하고
  // finishSocialLogin()도 두 번 돌아 네비게이션이 겹칠 수 있다. state만으로 막으면 두
  // 탭이 리렌더 전에 들어올 때 둘 다 통과하므로, ref로 동기적으로 막는다.
  const socialAuthBusyRef = useRef(false);
  const [socialAuthBusy, setSocialAuthBusy] = useState(false);

  const beginSocialAuth = () => {
    if (socialAuthBusyRef.current) return false;
    socialAuthBusyRef.current = true;
    setSocialAuthBusy(true);
    return true;
  };

  const endSocialAuth = () => {
    socialAuthBusyRef.current = false;
    setSocialAuthBusy(false);
  };

  const [googleLoading, setGoogleLoading] = useState(false);
  const { isConfigured: isGoogleConfigured, promptGoogleLogin } = useGoogleLogin({
    onSuccess: finishSocialLogin,
    onError: (err) => handleAuthError(err, 'auth.errors.loginFailed'),
  });

  const handleGoogleLogin = async () => {
    if (!beginSocialAuth()) return;
    setGoogleLoading(true);
    try {
      await promptGoogleLogin();
    } finally {
      setGoogleLoading(false);
      endSocialAuth();
    }
  };

  // 문서 동의와 함께 연령 확인도 켠다. 연령 확인은 문서에 대한 동의가 아니라 이용자에 관한
  // 사실 주장이라 성격이 다르므로, 범위를 라벨(auth.terms.agreeAll)이 밝히도록 해뒀다.
  // 일괄 토글에서 빼는 선택지도 있었으나, 그러면 "전체 동의"를 누르고도 가입 버튼이 안 열려
  // 이유를 찾아야 한다.
  const handleToggleAgreeAll = () => {
    const next = !allAgreed;
    setAgreed(next ? ALL_AGREEMENTS : NO_AGREEMENTS);
    setAgreeAge(next);
  };

  const toggleAgreement = (key: LegalDocumentKey) =>
    setAgreed((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleContinueToRegister = async () => {
    // 동의 사실은 이 화면에서만 알 수 있는데 가입 API를 부르는 곳은 다음 화면이다
    // (이메일은 register, 소셜은 complete-profile). 넘어가기 전에 **표시한 문서의
    // version 그대로** 스냅샷을 남긴다 — 다음 화면이 상수에서 다시 만들어내면 시트를
    // 거치지 않은 진입에서도 동의 기록이 생긴다.
    //
    // 버튼은 !allAgreed면 비활성이지만 보낼 값을 만드는 쪽에서 한 번 더 확인한다.
    const snapshot = buildConsentSnapshot(agreed, agreeAge);
    if (!snapshot) return;

    try {
      await savePendingConsent(snapshot);
    } catch (err) {
      // 저장이 실패한 채로 넘기면 다음 화면이 동의를 찾지 못해 시트로 되튕긴다.
      // 사용자에겐 "동의했는데 가입이 안 되는" 상태로만 보이므로 여기서 멈춘다.
      // (소셜 대기 promise는 아직 resolve하지 않았으므로 시트도 그대로 열려 있다.)
      handleAuthError(err, 'auth.errors.registerFailed');
      return;
    }

    const wasAwaitingSocialConsent = isAwaitingConsent();
    if (wasAwaitingSocialConsent) {
      resolveConsent(true);
    }
    termsSheetRef.current?.dismiss();
    if (!wasAwaitingSocialConsent) {
      router.push('/(auth)/register');
    }
  };

  const handleTermsSheetDismiss = () => {
    resolveConsent(false);
  };


  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>{t('auth.login.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.login.emailPlaceholder')}
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.login.passwordPlaceholder')}
        placeholderTextColor="#666"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />

      <Button
        title={t('auth.login.submit')}
        onPress={handleLogin}
        disabled={!canSubmit}
        loading={loading}
        style={styles.button}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t('auth.login.or')}</Text>
        <View style={styles.dividerLine} />
      </View>

      <Button
        title={t('auth.login.google')}
        onPress={handleGoogleLogin}
        variant="secondary"
        disabled={!isGoogleConfigured || socialAuthBusy}
        loading={googleLoading}
      />

      {/*
        Apple 로그인 임시 비활성화 — app.config.js의 ios 블록에 usesAppleSignIn: true가
        빠져 있어 entitlement 없이 signInAsync()가 모든 기기에서 ERR_REQUEST_NOT_HANDLED로
        실패한다(PR #48 3차 리뷰 #1). 컴포넌트와 테스트는 그대로 두고 노출만 막는다 —
        app.config.js 수정 + 실기기 검증(App Store 4.8) 마친 뒤 다시 연결한다.
      */}

      <TouchableOpacity style={styles.registerLink} onPress={openTermsSheet}>
        <Text style={styles.registerLinkText}>
          {t('auth.login.noAccount')}{' '}
          <Text style={styles.registerLinkAccent}>{t('auth.login.registerLink')}</Text>
        </Text>
      </TouchableOpacity>

      <BottomSheet
        ref={termsSheetRef}
        snapPoints={[termsView === 'list' ? '70%' : '85%']}
        onDismiss={handleTermsSheetDismiss}
        /*
          두 화면 모두 자체 스크롤을 가진다(BottomSheetView는 자신을 정적 콘텐츠로 등록해
          내부 스크롤을 죽이므로 감싸지 않는다).

          목록도 스크롤이 필요하다 — 위치기반서비스 약관과 연령 확인이 들어오며 카드가
          3개(전체동의 + 문서 2)에서 5개(전체동의 + 문서 3 + 연령)로 늘었다. snap이 70%라
          작은 화면이나 큰 접근성 폰트에서는 "동의하고 계속하기" 버튼이 시트 밖으로 밀리는데,
          정적 콘텐츠는 넘쳐도 스크롤되지 않고 **잘리므로** 가입 자체가 불가능해진다.

          겸해서 살아 있는 시트에서 BottomSheetView ↔ BottomSheetScrollView를 갈아끼우는
          동적 전환도 사라진다 — 다른 시트(NicknameNationalityFields·MessageActionSheet·
          SpotDetailSheet)는 모두 정적으로 지정하고 있어 이 파일만 예외였다.
        */
        scrollable
      >
        {termsView === 'list' ? (
          <BottomSheetScrollView contentContainerStyle={styles.sheetScrollContent}>
            <Text style={styles.termsTitle}>{t('auth.terms.title')}</Text>
            <Text style={styles.termsSubtitle}>{t('auth.terms.subtitle')}</Text>

            <Card onPress={handleToggleAgreeAll} selected={allAgreed} style={styles.termsItem}>
              <Text style={styles.termsItemText}>
                {allAgreed ? '☑' : '☐'} {t('auth.terms.agreeAll')}
              </Text>
            </Card>
            {LEGAL_DOCUMENT_KEYS.map((key) => (
              <Card key={key} selected={agreed[key]} style={styles.termsItem}>
                <View style={styles.termsRow}>
                  <TouchableOpacity
                    style={styles.termsCheckArea}
                    onPress={() => toggleAgreement(key)}
                  >
                    <Text style={styles.termsItemText}>
                      {agreed[key] ? '☑' : '☐'} {t(`auth.terms.${LEGAL_DOCUMENTS[key].labelKey}`)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setTermsView(key)}>
                    <Text style={styles.termsViewLink}>{t('auth.terms.viewLabel')}</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))}

            {/* 연령 확인만 '보기'가 없다 — 읽을 문서가 아니라 사실 확인이다. */}
            <Card
              onPress={() => setAgreeAge((prev) => !prev)}
              selected={agreeAge}
              style={styles.termsItem}
            >
              <Text style={styles.termsItemText}>
                {agreeAge ? '☑' : '☐'} {t('auth.terms.ageConfirm')}
              </Text>
            </Card>

            <Button
              title={t('auth.terms.continue')}
              onPress={handleContinueToRegister}
              disabled={!allAgreed}
              style={styles.termsContinueButton}
            />
          </BottomSheetScrollView>
        ) : (
          <BottomSheetScrollView contentContainerStyle={styles.sheetScrollContent}>
            <Text style={styles.termsTitle}>
              {t(`auth.terms.${LEGAL_DOCUMENTS[termsView].titleKey}`)}
            </Text>
            {/* locale이 'ko'|'en'을 벗어나도 빈 화면이 되지 않게 legalBody가 en으로 떨어뜨린다. */}
            <Text style={styles.detailBody}>{legalBody(termsView, locale)}</Text>
            <Button
              title={t('common.close')}
              onPress={() => setTermsView('list')}
              variant="secondary"
              style={styles.termsContinueButton}
            />
          </BottomSheetScrollView>
        )}
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: BrandColors.background,
    paddingHorizontal: 24,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  input: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  button: { marginTop: 8 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BrandColors.border },
  dividerText: { color: '#666', fontSize: 12, marginHorizontal: 12 },
  registerLink: { marginTop: 24, alignItems: 'center' },
  registerLinkText: { color: '#888', fontSize: 14 },
  registerLinkAccent: { color: BrandColors.accent, fontWeight: '600' },
  termsTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  termsSubtitle: { fontSize: 13, color: '#888', marginTop: 4, marginBottom: 20 },
  termsItem: { marginBottom: 10, paddingVertical: 14 },
  termsItemText: { fontSize: 15, color: '#fff' },
  termsContinueButton: { marginTop: 12 },
  termsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  termsCheckArea: { flex: 1 },
  termsViewLink: {
    fontSize: 13,
    color: BrandColors.accent,
    fontWeight: '600',
    marginLeft: 12,
    textDecorationLine: 'underline',
  },
  detailBody: { fontSize: 13, color: '#ccc', lineHeight: 20, marginTop: 4 },
  // 목록·상세 두 화면이 공유한다. BottomSheet가 scrollable일 때는 기본 BottomSheetView
  // (padding:16)로 감싸지 않으므로 여기서 같은 여백을 준다.
  sheetScrollContent: { padding: 16, paddingBottom: 32 },
});
