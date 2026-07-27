import { useMemo } from 'react';
import { Text, View, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useUserStore } from '@/store/useUserStore';
import { useTranslation } from '@/i18n';
import { BrandColors, Spacing } from '@/constants/theme';
import { getCountryList } from '@/constants/countries';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { logout } = useUserStore();
  const { t, locale } = useTranslation();

  // 로그인 시 채워진 캐시(queryKeys.auth.me)를 그대로 재사용 — 재요청 없이 즉시 표시되고,
  // store에는 없는 email/team까지 이 응답에 포함돼 있다.
  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: getMe,
  });

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const nationalityCountry = countries.find((c) => c.code === profile?.nationality) ?? null;

  const handleLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('profile.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: async () => {
          await signOut(auth);
          queryClient.removeQueries({ queryKey: queryKeys.auth.me });
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
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

      <Button
        title={t('profile.logout')}
        onPress={handleLogout}
        variant="danger"
        style={styles.logoutButton}
      />
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
  logoutButton: { width: '100%' },
});
