import { useState } from 'react';
import { Alert, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useRegisterMutation } from '@/hooks/use-auth';
import { useAuthSession } from '@/providers/AuthProvider';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { NicknameNationalityFields } from '@/components/auth/NicknameNationalityFields';

/**
 * Google/Apple 로그인으로 처음 들어온 유저가 닉네임/국적만 입력하고 가입을 마치는 화면.
 * 이메일/비밀번호 회원가입(register.tsx)과 달리 계정 생성·이메일 인증은 이미 Provider
 * 쪽에서 끝난 상태로 여기 도착하므로(useFinishSocialLogin), 남은 절차는 registerUser()
 * 한 번뿐이다.
 */
export default function CompleteProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const handleAuthError = useHandleAuthError();
  const registerMutation = useRegisterMutation();
  const { firebaseUser } = useAuthSession();

  const [nickname, setNickname] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const canSubmit =
    nickname.trim().length >= 2 && selectedCode !== null && !registerMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedCode) return;
    try {
      await registerMutation.mutateAsync({ nickname: nickname.trim(), nationality: selectedCode });
      router.replace('/');
    } catch (err) {
      // 다른 기기에서 거의 동시에 가입을 마친 레이스는 에러가 아니라 정상 진입으로 취급한다.
      if (isAxiosError(err) && err.response?.status === 409) {
        // queryKeys.auth.me 캐시에는 이 화면에 들어오기 전 useFinishSocialLogin이 채워둔
        // "미가입"(null)이 아직 남아 있다. react-query는 data가 null이어도 이미 fetch된
        // 값으로 보아 isPending을 false로 두므로, 캐시를 갱신하지 않고 이동하면 index.tsx가
        // 그 낡은 null을 보고 isAuthenticated:false로 판단해 온보딩 화면으로 되돌려 보낸다
        // (registerMutation의 정상 성공 경로는 onSuccess가 캐시를 즉시 채우므로 이 문제가
        // 없다). 실제로 가입이 끝난 상태이므로 다시 조회해 캐시를 바로잡은 뒤 이동한다.
        //
        // 이 409는 항상 "다른 기기에서 동시 가입" 레이스인 것은 아니다 — 백엔드가
        // unique(firebaseUid|email) 위반도 같은 409로 매핑하므로, 다른 firebaseUid가
        // 이미 이 이메일로 가입한 경우(PR #48 리뷰 지적)에는 현재 uid의 getMe가 계속
        // null이다. 그 경우와 조회 자체가 실패하는 경우(오프라인/5xx) 모두 unhandled
        // rejection이나 온보딩 오탈출로 새지 않도록 에러 처리·반환값 검사를 둔다.
        try {
          const profile = await queryClient.fetchQuery({
            queryKey: queryKeys.auth.me,
            queryFn: getMe,
          });
          if (!profile) {
            // 진짜 동시 가입 레이스라면 재조회로 profile이 채워졌을 것이다. 그래도 계속
            // null이라면 다른 firebaseUid가 이미 이 이메일로 가입한 unique(email) 충돌형
            // 409로, 현재 uid로는 재시도해도 영원히 null만 나와 이 화면을 벗어날 방법이
            // 없다(PR #48 3차 리뷰 #4). 세션을 정리하고 로그인 화면으로 돌려보낸다.
            await signOut(auth);
            Alert.alert(t('auth.errors.title'), t('auth.errors.emailAlreadyInUse'));
            router.replace('/(auth)/login');
            return;
          }
          router.replace('/');
        } catch (refetchErr) {
          handleAuthError(refetchErr, 'auth.errors.registerFailed');
        }
        return;
      }
      handleAuthError(err, 'auth.errors.registerFailed');
    }
  };

  // 이 화면은 Google/Apple 로그인 직후에만 의미가 있다 — Firebase 세션 없이 직접
  // 진입했다면(딥링크 등) 로그인 화면으로 되돌린다. auth.currentUser를 직접 보지 않고
  // AuthProvider의 firebaseUser를 쓰는 이유는, 세션 복원 전(콜드 스타트 직후)의 "초기화
  // 중" 상태와 "로그인 안 됨" 상태를 앱 전체가 쓰는 것과 같은 기준으로 구분하기 위해서다
  // — AuthProvider는 세션이 확정되기(sessionResolved) 전까지 children을 아예 마운트하지
  // 않으므로, 이 화면이 렌더된 시점엔 firebaseUser가 이미 확정된 값이다.
  if (!firebaseUser) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('auth.completeProfile.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.completeProfile.subtitle')}</Text>

        <NicknameNationalityFields
          nickname={nickname}
          onNicknameChange={setNickname}
          selectedCode={selectedCode}
          onSelectCountry={setSelectedCode}
          editable={!registerMutation.isPending}
        />

        <Button
          title={t('auth.completeProfile.submit')}
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={registerMutation.isPending}
          style={styles.submitButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  content: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: '#888', marginTop: 8, marginBottom: 24, textAlign: 'center' },
  submitButton: { marginTop: 8 },
});
