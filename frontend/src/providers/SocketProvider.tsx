import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useOverlayStore, isDuelBusy } from '@/store/useOverlayStore';
// 훅(useTranslation)이 아니라 i18n 인스턴스를 직접 쓴다 — 훅이 반환하는 t는 매 렌더
// 새로 bind된 함수라 effect 의존성에 넣으면 소켓 리스너 전체가 렌더마다 재등록된다.
// 아래 핸들러들은 이벤트 발생 시점에 호출되므로 i18n.t가 그때의 locale을 그대로 읽는다.
import { i18n } from '@/i18n';
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

/**
 * 서버 핸들러가 throw하면 ack 콜백 대신 이 이벤트가 온다
 * (backend/src/common/filters/ws-exception.filter.ts 주석 참고) — 구독하지 않으면
 * "결투 신청" 후 사거리 이탈·페널티 등으로 거절당해도 화면이 그대로 멈춘다.
 */
interface WsExceptionPayload {
  code: string;
  message: string | string[];
}

interface DuelCompleted {
  duelId: number;
  winnerId: string;
  loserId: string;
  scoreDelta: number;
  allyBonusApplied: boolean;
}

const SocketContext = createContext<Socket | null>(null);

/**
 * socket.io는 매 연결·재연결 시도 직전에 이 함수를 호출하므로, 여기서 토큰을 읽으면
 * 재연결 때마다 자동으로 최신 토큰이 실린다. `getIdToken()`은 만료된 경우에만 내부적으로
 * 갱신하고 그 외에는 캐시를 돌려주므로, 별도의 강제 갱신(getIdToken(true)) 재시도 로직이
 * 필요 없다 — 예전엔 connect_error마다 강제 갱신 후 직접 connect()를 다시 불렀는데,
 * 그러면 socket.io 자체의 지수 백오프를 건너뛰고 Firebase 토큰 갱신을 무한 반복했다.
 */
function realtimeAuth(cb: (data: { token: string | null }) => void) {
  void (async () => {
    try {
      cb({ token: (await auth.currentUser?.getIdToken()) ?? null });
    } catch {
      // 토큰을 못 얻으면 서버가 핸드셰이크에서 거부하고, socket.io가 백오프를 두고 재시도한다.
      cb({ token: null });
    }
  })();
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

  // 로그인 상태를 따라 연결을 시작/종료한다. 실패 시 재시도는 socket.io의 내장
  // 재연결(지수 백오프)에 맡기고, 토큰은 realtimeAuth가 시도마다 새로 읽는다.
  useEffect(() => {
    if (!isAuthenticated) {
      socket.disconnect();
      return;
    }
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated, socket]);

  // encounter:detected는 Provider 레벨에서 한 번만 배선한다 — 어느 탭에 있든 적 탐지
  // 알림이 떠야 하기 때문(PR #17 리뷰 권고, docs/integrations.md 참고).
  useEffect(() => {
    const handleEncounter = (payload: EncounterDetected) => {
      // 이미 결투 흐름이 진행 중이면(응답 대기·수락 왕복 포함) 새 조우 알림으로
      // enemyInfo를 덮어쓰지 않는다 — 덮어쓰면 엉뚱한 제3자를 승자로 신고하게 된다.
      if (isDuelBusy(useOverlayStore.getState())) return;

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
      if (isDuelBusy(store)) return;

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
      if (wasChallenger) Alert.alert(i18n.t('overlay.duelOutcome.title'), i18n.t('overlay.duelOutcome.rejected'));
    };

    const handleDuelExpired = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      Alert.alert(i18n.t('overlay.duelOutcome.title'), i18n.t('overlay.duelOutcome.expired'));
    };

    const handleDuelCompleted = (payload: DuelCompleted) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      const didWin = profile != null && payload.winnerId === profile.id;
      Alert.alert(
        i18n.t('overlay.duelOutcome.title'),
        didWin ? i18n.t('overlay.duelOutcome.win') : i18n.t('overlay.duelOutcome.lose'),
      );
    };

    const handleDuelVoided = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.resetDuel();
      Alert.alert(i18n.t('overlay.duelOutcome.title'), i18n.t('overlay.duelOutcome.voided'));
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
  }, [socket, profile]);

  // 서버가 거절한 요청(사거리 이탈, 페널티, 이미 처리된 결투 등)을 사용자에게 알린다.
  // 이걸 구독하지 않으면 ack가 오지 않는 실패 경로에서 오버레이가 영영 열린 채 멈춘다.
  useEffect(() => {
    const handleException = (payload: WsExceptionPayload) => {
      const known = `overlay.duelError.${payload.code}`;
      const translated = i18n.t(known);
      // i18n-js는 없는 키에 대해 "[missing ...]" 문자열을 돌려준다 — 아직 매핑하지 않은
      // 코드는 서버가 보낸 메시지로 폴백한다(서버 문구는 한국어 고정).
      const message = translated.startsWith('[missing')
        ? [payload.message].flat().join('\n')
        : translated;

      // 결투 관련 실패면 진행 중이던 오버레이를 정리한다 — location:update 검증 오류 같은
      // 무관한 예외까지 결투를 취소시키지 않도록 코드 접두사로 구분한다.
      if (payload.code.startsWith('DUEL_')) useOverlayStore.getState().resetDuel();

      Alert.alert(i18n.t('overlay.duelError.title'), message);
    };

    socket.on('exception', handleException);
    return () => {
      socket.off('exception', handleException);
    };
  }, [socket]);

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
