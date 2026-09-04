import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { queryKeys } from '@/lib/query-keys';
import { BrandColors } from '@/constants/theme';
import { useChatStore } from '@/store/useChatStore';
import { clearAllVisitCheckins } from '@/lib/visit-checkin';

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
        // useChatStore는 (main) 라우트 그룹보다 오래 사는 모듈 스코프 zustand라,
        // 로그아웃은 signOut 후 라우팅일 뿐 JS 컨텍스트가 유지되는 한 이전 사용자의
        // 팀 채팅 피드가 그대로 남는다 — 같은 기기에서 계정을 바꾸면 A가 보낸 메시지가
        // mine:true인 채로 B 자신의 말풍선처럼 오른쪽 정렬돼 보인다(PR #50 3차 리뷰
        // 지적 6번). moderation.blocks도 위 auth.me와 같은 이유로 함께 지운다 — 안
        // 지우면 gcTime(기본 5분) 동안 A가 차단한 사용자 목록이 B의 화면에 리페치가
        // 끝나기 전까지 잠깐 보인다(3차 리뷰 지적 7번).
        useChatStore.getState().clear();
        queryClient.removeQueries({ queryKey: queryKeys.moderation.blocks });
        // visit-checkin의 저장 키도 유저 구분이 없는 기기 스코프라 같은 문제를
        // 겪는다 — 탈퇴·계정 전환 후에도 이전 사용자의 방문 체크인이 남아 다음
        // 사용자에게 넘어간다(PR #53 리뷰 지적 6번).
        void clearAllVisitCheckins();
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
