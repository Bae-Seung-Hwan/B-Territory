import { useMemo } from 'react';
import { Text, View, StyleSheet, Alert, Linking, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useDeleteAccountMutation } from '@/hooks/use-account';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useTranslation } from '@/i18n';
import { BrandColors, Spacing } from '@/constants/theme';
import { getCountryList } from '@/constants/countries';
import { CONTACT_EMAIL } from '@/constants/contact';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export default function ProfileScreen() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const handleAuthError = useHandleAuthError();

  // 인증 상태와 같은 소스(queryKeys.auth.me)를 그대로 읽는다 — 로그인 때 채워진
  // 캐시라 재요청 없이 즉시 표시된다.
  const { profile, isLoading } = useAuth();
  const deleteAccountMutation = useDeleteAccountMutation();

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const nationalityCountry = useMemo(
    () => countries.find((c) => c.code === profile?.nationality) ?? null,
    [countries, profile?.nationality],
  );

  const handleContact = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => {
      // 메일 앱이 없는 환경(에뮬레이터 등) — 이메일 자체는 화면에 항상 텍스트로도 보이므로
      // 여기서 실패해도 문의처 확인 자체는 가능하다.
    });
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: async () => {
          // 캐시 정리는 AuthProvider가 세션 변경을 보고 처리한다. 세션 만료처럼
          // 이 화면을 거치지 않는 경로까지 한 곳에서 덮기 위함.
          await signOut(auth);
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  // 백엔드가 계정을 완전히 삭제한 뒤라 서버 쪽 세션은 이미 무효다. signOut은 이 기기의
  // 로컬 Firebase 세션만 정리하는 것이고, 로그아웃과 마찬가지로 캐시 정리는 AuthProvider가
  // 세션 변경을 보고 처리한다.
  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.deleteAccountConfirmTitle'),
      t('profile.deleteAccountConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.deleteAccount'),
          style: 'destructive',
          onPress: () => {
            deleteAccountMutation.mutate(undefined, {
              onSuccess: async () => {
                await signOut(auth);
                router.replace('/(auth)/login');
              },
              onError: (err) => handleAuthError(err, 'profile.errors.deleteAccountFailed'),
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{t('profile.title')}</Text>

      {isLoading || !profile ? (
        <Text style={styles.loading}>{t('profile.loading')}</Text>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.nickname}>{profile.nickname}</Text>
          <Text style={styles.row}>
            {t('profile.emailLabel')}: {profile.email}
          </Text>
          <View style={styles.badgeRow}>
            <Text style={styles.row}>{t('profile.nationalityLabel')}</Text>
            <Badge
              label={
                nationalityCountry
                  ? `${nationalityCountry.flag} ${nationalityCountry.name}`
                  : profile.nationality
              }
              variant="accent"
            />
          </View>
          <Text style={styles.row}>
            {t('profile.teamLabel')}: {profile.team}
          </Text>
        </Card>
      )}

      <Text style={styles.placeholder}>{t('profile.placeholder')}</Text>

      <View style={styles.menu}>
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() => router.push('/(main)/profile/blocked-users')}
        >
          <Text style={styles.menuLabel}>{t('profile.blockedUsersLink')}</Text>
          <Ionicons name="chevron-forward" size={18} color="#666" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={handleContact}>
          <View>
            <Text style={styles.menuLabel}>{t('profile.contactTitle')}</Text>
            <Text style={styles.menuSubLabel}>{CONTACT_EMAIL}</Text>
          </View>
          <Ionicons name="mail-outline" size={18} color="#666" />
        </TouchableOpacity>
      </View>

      <Button
        title={t('profile.logout')}
        onPress={handleLogout}
        variant="danger"
        style={styles.logoutButton}
      />

      {/* 로그아웃과 달리 되돌릴 수 없는 조작이라, 같은 무게의 버튼이 아니라 눈에 덜 띄는
          텍스트 링크로 둔다 — 오터치로 탈퇴 확인창까지 가는 일을 줄이기 위함. */}
      <TouchableOpacity
        onPress={handleDeleteAccount}
        disabled={deleteAccountMutation.isPending}
        style={styles.deleteAccountLink}
      >
        <Text style={styles.deleteAccountText}>
          {deleteAccountMutation.isPending
            ? t('profile.deleteAccountPending')
            : t('profile.deleteAccount')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    backgroundColor: BrandColors.background,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 24 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 6 },
  loading: { color: '#888', fontSize: 14, marginBottom: 24 },
  card: { marginBottom: Spacing.three },
  nickname: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 12 },
  row: { fontSize: 14, color: '#ccc', marginBottom: 6 },
  placeholder: { color: '#555', fontSize: 12, marginBottom: Spacing.five },
  menu: {
    width: '100%',
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    marginBottom: Spacing.four,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  menuLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  menuSubLabel: { color: '#888', fontSize: 12, marginTop: 2 },
  logoutButton: { width: '100%' },
  deleteAccountLink: { marginTop: Spacing.three, padding: Spacing.two },
  deleteAccountText: { color: '#666', fontSize: 13, textDecorationLine: 'underline' },
});
