import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { queryKeys } from '@/lib/query-keys';
import { BrandColors } from '@/constants/theme';
import { useBattleStore } from '@/store/useBattleStore';
import { useOverlayStore } from '@/store/useOverlayStore';

interface AuthSession {
  firebaseUser: User | null;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

/**
 * Firebase 세션만 담당한다. 프로필 조회와 "로그인된 상태인가"의 판단은
 * useAuth()가 queryKeys.auth.me 쿼리 하나에서 파생시킨다.
 *
 * 이 provider가 직접 getMe를 호출하고 스토어에 인증 상태까지 쓰던 이전 구조에서는,
 * 화면(login/register)과 이 리스너가 각자 getMe 결과를 캐시·스토어에 쓰면서 완료
 * 순서에 따라 서로를 덮어썼다(회원가입 직후 404 응답이 방금 받은 프로필을 지우는
 * 레이스). 쓰는 곳을 한 곳으로 모아 그 클래스의 버그를 구조적으로 없앤다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  // undefined = 아직 첫 이벤트 전, null = 로그인된 사용자 없음. 둘 다 "버릴 이전
  // 사용자가 없는" 상태다.
  const previousUidRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      const nextUid = nextUser?.uid ?? null;
      const previousUid = previousUidRef.current;
      previousUidRef.current = nextUid;

      // 로그아웃·세션 만료·계정 전환처럼 "직전 사용자가 있었고 그 사용자가 아니게 된"
      // 경우에만 프로필 캐시를 버린다. 로그아웃 버튼을 거치지 않는 경로로도 null이
      // 오므로 정리를 화면이 아니라 여기에 두어야, 이전 사용자 정보가 gcTime 동안
      // 남아 재로그인 리페치 도중 잠깐 노출되는 일이 없다.
      //
      // 로그인/회원가입(이전 사용자 없음 -> 새 사용자)은 지울 대상이 애초에 없고,
      // 여기서 지우면 로그인 화면이 방금 받아 캐시에 넣은 프로필까지 날려 불필요한
      // 재조회를 유발하므로 제외한다.
      const hadPreviousUser = previousUid !== undefined && previousUid !== null;
      if (hadPreviousUser && previousUid !== nextUid) {
        queryClient.removeQueries({ queryKey: queryKeys.auth.me });
        // useBattleStore/useOverlayStore는 모듈 스코프 zustand라 (main) 라우트 그룹보다
        // 오래 산다 — 로그아웃은 signOut 후 라우팅일 뿐 JS 컨텍스트가 유지되는 한 이전
        // 사용자 주변에 있던 상대(userId·닉네임)가 BATTLE_ENEMY_STALE_MS(2분)까지 배틀
        // 탭에 그대로 남고, 남아 있던 duelId가 isDuelBusy를 참으로 만들어 새로 로그인한
        // 사용자에게 온 duel:requested를 조용히 삼킨다(PR #54 리뷰 지적 10번).
        useBattleStore.getState().reset();
        useOverlayStore.getState().resetDuel();
      }

      setFirebaseUser(nextUser);
      setSessionResolved(true);
    });
  }, [queryClient]);

  // 세션 확인 전에 children을 마운트하면 app/index.tsx가 유효한 세션을 보지 못한 채
  // 온보딩으로 보내버린다.
  if (!sessionResolved) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={BrandColors.accent} />
      </View>
    );
  }

  return (
    <AuthSessionContext.Provider value={{ firebaseUser }}>{children}</AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const session = useContext(AuthSessionContext);
  if (!session) throw new Error('useAuthSession must be used within AuthProvider');
  return session;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.background,
  },
});
