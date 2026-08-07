import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useTranslation } from '@/i18n';
import { ENCOUNTER_RADIUS_M } from '@/constants/game';

interface EncounterDetected {
  userId: string;
  nickname: string | null;
  team: string;
}

interface DuelRequested {
  duelId: number;
  fromUserId: string;
  fromNickname: string | null;
}

interface DuelIdPayload {
  duelId: number;
}

interface DuelCompleted {
  duelId: number;
  winnerId: string;
  loserId: string;
  scoreDelta: number;
  allyBonusApplied: boolean;
}

const SocketContext = createContext<Socket | null>(null);

// SocketProvider는 앱 루트에 단 한 번만 마운트되는 싱글턴이라(app/_layout.tsx), 이 소켓의
// 인증 토큰도 모듈 스코프에 둔다. React state/ref로 두면 재연결 시 갱신하는 지점에서
// "useState/useRef가 반환한 값을 렌더 중 또는 직접 mutate하면 안 된다"는 최신
// react-hooks lint 규칙(immutability/refs)과 부딪힌다 — socket.io-client 인스턴스 자체가
// React가 관리하지 않는 명령형 객체라는 점과 같은 이유다.
let realtimeAuthToken: string | null = null;

function realtimeAuth(cb: (data: { token: string | null }) => void) {
  cb({ token: realtimeAuthToken });
}

export function SocketProvider({ children }: { children: ReactNode }) {
  // 백엔드 RealtimeGateway가 '/realtime' 네임스페이스로 선언돼 있다(realtime.gateway.ts) —
  // 기본 네임스페이스('/')로 붙으면 어떤 게이트웨이도 요청을 받지 않아 전부 조용히 무시된다.
  const [socket] = useState(() =>
    io(`${API_BASE_URL}/realtime`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: realtimeAuth,
    }),
  );
  const { isAuthenticated, profile } = useAuth();
  const { t } = useTranslation();

  // 로그인 상태를 따라 연결을 시작/종료한다. 매 시도마다 토큰을 새로 읽어와야
  // Firebase ID Token(최대 1시간 유효) 만료 이후의 재연결에서도 유효한 토큰을 쓴다.
  useEffect(() => {
    if (!isAuthenticated) {
      socket.disconnect();
      return;
    }

    let cancelled = false;

    const connectWithToken = async (forceRefresh: boolean) => {
      const token = await auth.currentUser?.getIdToken(forceRefresh);
      if (cancelled || !token) return;
      realtimeAuthToken = token;
      socket.connect();
    };

    void connectWithToken(false);

    // 인증 거부(만료된 토큰 등)로 연결이 실패하면 강제 갱신 후 한 번 더 시도한다.
    const handleConnectError = () => {
      void connectWithToken(true);
    };
    socket.on('connect_error', handleConnectError);

    return () => {
      cancelled = true;
      socket.off('connect_error', handleConnectError);
      socket.disconnect();
    };
  }, [isAuthenticated, socket]);

  // encounter:detected는 Provider 레벨에서 한 번만 배선한다 — 어느 탭에 있든 적 탐지
  // 알림이 떠야 하기 때문(PR #17 리뷰 권고, docs/integrations.md 참고).
  useEffect(() => {
    const handleEncounter = (payload: EncounterDetected) => {
      const { showDuelRequest, showMiniGame } = useOverlayStore.getState();
      // 이미 결투 진행 중이면 새 조우 알림으로 흐름을 방해하지 않는다.
      if (showDuelRequest || showMiniGame) return;

      useOverlayStore.getState().setEnemyInfo({
        userId: payload.userId,
        nationality: payload.team,
        // encounter:detected엔 정확한 거리가 실려오지 않는다 — 탐지 자체가 이 반경
        // 안에서만 일어나므로 근사값으로 표시한다.
        distance: ENCOUNTER_RADIUS_M,
      });
      useOverlayStore.getState().setShowEnemyAlert(true);
    };

    socket.on('encounter:detected', handleEncounter);
    return () => {
      socket.off('encounter:detected', handleEncounter);
    };
  }, [socket]);

  // 결투 생명주기(신청 수신 ~ 결과 확정) 전체를 Provider 레벨에서 배선한다 — 어느 탭에
  // 있든 상대의 신청을 받거나 결과를 알림받아야 하고, 그때그때 열려있는 오버레이도
  // 여기서 일괄 정리해야 화면별로 각자 정리 로직을 중복시키지 않는다.
  useEffect(() => {
    const handleDuelRequested = (payload: DuelRequested) => {
      const store = useOverlayStore.getState();
      // 이미 다른 결투가 진행 중이면 새 신청을 받지 않는다 — 서버엔 별도 "거절"을
      // 보내지 않으므로, 신청자 쪽에서는 30초 후 duel:expired로 자연스럽게 정리된다.
      if (store.showDuelPending || store.showDuelRequest || store.showMiniGame) return;

      store.setDuelId(payload.duelId);
      store.setDuelRole('recipient');
      store.setChallengerNickname(payload.fromNickname);
      // MiniGame의 승자 판정(handleFinish)이 상대 userId를 필요로 한다 — duel:requested엔
      // team이 없어 nationality는 채우지 못하지만(DuelRequest 시트는 안 씀), userId는 있어야 한다.
      store.setEnemyInfo({ userId: payload.fromUserId, nationality: '', distance: ENCOUNTER_RADIUS_M });
      store.setShowDuelRequest(true);
    };

    const handleDuelAccepted = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.setShowDuelPending(false);
      store.setShowDuelRequest(false);
      store.setShowMiniGame(true);
    };

    const handleDuelRejected = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      const wasChallenger = store.duelRole === 'challenger';
      store.resetDuel();
      // 거부한 당사자에게는 자기 행동을 다시 알려줄 필요가 없다 — 신청자에게만 안내한다.
      if (wasChallenger) Alert.alert(t('overlay.duelOutcome.title'), t('overlay.duelOutcome.rejected'));
    };

    const handleDuelExpired = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      Alert.alert(t('overlay.duelOutcome.title'), t('overlay.duelOutcome.expired'));
    };

    const handleDuelCompleted = (payload: DuelCompleted) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      const didWin = profile != null && payload.winnerId === profile.id;
      Alert.alert(
        t('overlay.duelOutcome.title'),
        didWin ? t('overlay.duelOutcome.win') : t('overlay.duelOutcome.lose'),
      );
    };

    const handleDuelVoided = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      Alert.alert(t('overlay.duelOutcome.title'), t('overlay.duelOutcome.voided'));
    };

    socket.on('duel:requested', handleDuelRequested);
    socket.on('duel:accepted', handleDuelAccepted);
    socket.on('duel:rejected', handleDuelRejected);
    socket.on('duel:expired', handleDuelExpired);
    socket.on('duel:completed', handleDuelCompleted);
    socket.on('duel:voided', handleDuelVoided);
    return () => {
      socket.off('duel:requested', handleDuelRequested);
      socket.off('duel:accepted', handleDuelAccepted);
      socket.off('duel:rejected', handleDuelRejected);
      socket.off('duel:expired', handleDuelExpired);
      socket.off('duel:completed', handleDuelCompleted);
      socket.off('duel:voided', handleDuelVoided);
    };
  }, [socket, profile, t]);

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
