import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useUserStore } from '@/store/useUserStore';
import { BrandColors } from '@/constants/theme';

/**
 * firebase.ts가 AsyncStorage로 Firebase 세션 자체는 지속시키지만, 그것만으로는
 * useUserStore.isAuthenticated가 채워지지 않는다(항상 false로 초기화). 앱 부팅 시
 * onAuthStateChanged로 기존 세션 여부를 확인해 store를 rehydrate해야, 유효한 세션이
 * 있을 때 app/index.tsx가 온보딩/로그인 대신 map으로 보낼 수 있다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { setUserId, setNickname, setNationality, setAuthenticated, logout } = useUserStore();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        logout();
        setInitializing(false);
        return;
      }

      try {
        const profile = await queryClient.fetchQuery({
          queryKey: queryKeys.auth.me,
          queryFn: getMe,
        });

        if (profile) {
          setUserId(profile.id);
          setNickname(profile.nickname);
          setNationality(profile.nationality);
          setAuthenticated(true);
        } else {
          setAuthenticated(false);
        }
      } catch {
        setAuthenticated(false);
      } finally {
        setInitializing(false);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initializing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={BrandColors.accent} />
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.background,
  },
});
