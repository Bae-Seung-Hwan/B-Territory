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
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const termsSheetRef = useRef<BottomSheetModal>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [termsView, setTermsView] = useState<'list' | 'service' | 'privacy'>('list');
  const allAgreed = agreeTerms && agreePrivacy;

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
    router.replace('/(main)/map');
  };

  const handleAuthError = useHandleAuthError();

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

  const handleGoogleLogin = () => {
    Alert.alert(t('auth.login.googleComingSoonTitle'), t('auth.login.googleComingSoonMessage'));
  };

  const openTermsSheet = () => {
    setAgreeTerms(false);
    setAgreePrivacy(false);
    setTermsView('list');
    termsSheetRef.current?.present();
  };

  const handleToggleAgreeAll = () => {
    const next = !allAgreed;
    setAgreeTerms(next);
    setAgreePrivacy(next);
  };

  const handleContinueToRegister = () => {
    termsSheetRef.current?.dismiss();
    router.push('/(auth)/register');
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
        style={styles.googleButton}
      />

      <AppleSignInButton />

      <TouchableOpacity style={styles.registerLink} onPress={openTermsSheet}>
        <Text style={styles.registerLinkText}>
          {t('auth.login.noAccount')}{' '}
          <Text style={styles.registerLinkAccent}>{t('auth.login.registerLink')}</Text>
        </Text>
      </TouchableOpacity>

      <BottomSheet ref={termsSheetRef} snapPoints={[termsView === 'list' ? '58%' : '70%']}>
        {termsView === 'list' ? (
          <>
            <Text style={styles.termsTitle}>{t('auth.terms.title')}</Text>
            <Text style={styles.termsSubtitle}>{t('auth.terms.subtitle')}</Text>

            <Card onPress={handleToggleAgreeAll} selected={allAgreed} style={styles.termsItem}>
              <Text style={styles.termsItemText}>
                {allAgreed ? '☑' : '☐'} {t('auth.terms.agreeAll')}
              </Text>
            </Card>
            <Card selected={agreeTerms} style={styles.termsItem}>
              <View style={styles.termsRow}>
                <TouchableOpacity
                  style={styles.termsCheckArea}
                  onPress={() => setAgreeTerms((prev) => !prev)}
                >
                  <Text style={styles.termsItemText}>
                    {agreeTerms ? '☑' : '☐'} {t('auth.terms.serviceTerms')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setTermsView('service')}>
                  <Text style={styles.termsViewLink}>{t('auth.terms.viewLabel')}</Text>
                </TouchableOpacity>
              </View>
            </Card>
            <Card selected={agreePrivacy} style={styles.termsItem}>
              <View style={styles.termsRow}>
                <TouchableOpacity
                  style={styles.termsCheckArea}
                  onPress={() => setAgreePrivacy((prev) => !prev)}
                >
                  <Text style={styles.termsItemText}>
                    {agreePrivacy ? '☑' : '☐'} {t('auth.terms.privacyPolicy')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setTermsView('privacy')}>
                  <Text style={styles.termsViewLink}>{t('auth.terms.viewLabel')}</Text>
                </TouchableOpacity>
              </View>
            </Card>

            <Button
              title={t('auth.terms.continue')}
              onPress={handleContinueToRegister}
              disabled={!allAgreed}
              style={styles.termsContinueButton}
            />
          </>
        ) : (
          <>
            <Text style={styles.termsTitle}>
              {termsView === 'service'
                ? t('auth.terms.serviceTermsTitle')
                : t('auth.terms.privacyPolicyTitle')}
            </Text>
            <Text style={styles.detailBody}>
              {termsView === 'service'
                ? t('auth.terms.serviceTermsBody')
                : t('auth.terms.privacyPolicyBody')}
            </Text>
            <Button
              title={t('auth.terms.closeLabel')}
              onPress={() => setTermsView('list')}
              variant="secondary"
              style={styles.termsContinueButton}
            />
          </>
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
  googleButton: { opacity: 0.6 },
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
});
