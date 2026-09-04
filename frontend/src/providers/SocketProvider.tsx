import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { useOverlayStore, isDuelBusy, type MiniGameType, type LocalizedText } from '@/store/useOverlayStore';
import { useBattleStore } from '@/store/useBattleStore';
// 훅(useTranslation)이 아니라 i18n 인스턴스를 직접 쓴다 — 훅이 반환하는 t는 매 렌더
// 새로 bind된 함수라 effect 의존성에 넣으면 소켓 리스너 전체가 렌더마다 재등록된다.
// 아래 핸들러들은 이벤트 발생 시점에 호출되므로 i18n.t가 그때의 locale을 그대로 읽는다.
import { i18n } from '@/i18n';
import { ENCOUNTER_RADIUS_M, BATTLE_SWEEP_INTERVAL_MS } from '@/constants/game';

export interface EncounterDetected {
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

/**
 * exception 페이로드엔 어떤 emit에 대한 실패인지 알려줄 duelId가 없다(WsExceptionPayload
 * 참고) — 그래서 "DUEL_ 코드면 무조건 지금 열려 있는 결투를 지운다"고 하면, 내 새
 * duel:request가 (예: DUEL_ALREADY_PENDING으로) 실패한 순간 마침 열려 있던 **남의**
 * 결투(수락 대기 시트 등)까지 함께 날아간다(PR #54 리뷰 지적 4번).
 *
 * 이 목록은 requestDuel()(duels.service.ts)이 "새 결투를 못 열었다"는 뜻으로만 던지는
 * 코드다 — 이런 코드는 애초에 overlay 상태에 아무것도 쓴 적이 없으므로(성공 ack가 와야만
 * BattleEnemyRow가 duelId를 채운다) resetDuel()이 지울 내 것이 없고, 혹시 다른 결투가
 * 열려 있었다면 그건 반드시 남의 것이다. 목록에 없는 DUEL_ 코드(duel:accept/reject/
 * game:submit 실패 등)는 내가 지금 들고 있는 duelId에 대한 응답이 거의 확실하므로 그대로
 * resetDuel()한다.
 */
const DUEL_REQUEST_ONLY_CODES = new Set([
  'DUEL_SELF_CHALLENGE',
  'DUEL_TARGET_NOT_FOUND',
  'DUEL_SAME_TEAM',
  'DUEL_CHALLENGER_PENALTY',
  'DUEL_TARGET_PENALTY',
  'DUEL_TARGET_UNAVAILABLE',
  'DUEL_TARGET_LOCATION_UNKNOWN',
  'DUEL_OUT_OF_RANGE',
  'DUEL_ALREADY_ACTIVE',
  'DUEL_ALREADY_PENDING',
]);

interface DuelCompleted {
  duelId: number;
  winnerId: string;
  loserId: string;
  scoreDelta: number;
  allyBonusApplied: boolean;
}

interface GameStartPayload {
  duelId: number;
  gameType: MiniGameType;
  round: number;
  maxRounds: number;
  deadlineAt: number;
  tap?: { durationSec: number };
  quiz?: { question: LocalizedText; choices: LocalizedText[] };
}

interface GameRoundPayload {
  duelId: number;
  round: number;
}

interface GameRoundResultPayload {
  duelId: number;
  round: number;
  winnerId: null;
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

  // encounter:detected는 Provider 레벨에서 한 번만 배선한다 — 어느 탭에 있든 배틀 탭의
  // 근처 상대 리스트가 갱신돼야 하기 때문(PR #17 리뷰 권고, docs/integrations.md 참고).
  // 결투 진행 여부와 무관하게 항상 갱신한다 — 목록은 "지금 근처에 있는 상대"를 보여줄
  // 뿐이라 isDuelBusy 가드가 필요 없다(팝업 시절엔 enemyInfo 덮어쓰기 방지가 필요했지만,
  // 이제 enemyInfo는 실제 결투 신청 시점에만 별도로 세팅된다 — BattleEnemyRow 참고).
  useEffect(() => {
    const handleEncounter = (payload: EncounterDetected) => {
      useBattleStore.getState().upsertEnemy(payload);
    };

    socket.on('encounter:detected', handleEncounter);

    // 서버는 같은 쌍에 대해 60초간 encounter:detected를 재발송하지 않으므로, 상대가
    // 실제로 멀어졌는지는 클라이언트가 주기적으로 갱신 시각을 확인해 판단해야 한다.
    const sweep = setInterval(
      () => useBattleStore.getState().pruneStale(Date.now()),
      BATTLE_SWEEP_INTERVAL_MS,
    );

    return () => {
      socket.off('encounter:detected', handleEncounter);
      clearInterval(sweep);
    };
  }, [socket]);

  // 결투 생명주기(신청 수신 ~ 결과 확정) 전체를 Provider 레벨에서 배선한다 — 어느 탭에
  // 있든 상대의 신청을 받거나 결과를 알림받아야 하고, 그때그때 열려있는 오버레이도
  // 여기서 일괄 정리해야 화면별로 각자 정리 로직을 중복시키지 않는다.
  useEffect(() => {
    const handleDuelRequested = (payload: DuelRequested) => {
      const store = useOverlayStore.getState();
      // 내가 보낸 duel:request의 ack 왕복 구간(emit~ack)도 바쁜 것으로 쳐야 한다.
      // isDuelBusy(OverlayStore)는 이 구간을 모른다 — pendingChallengeTargetId는
      // useBattleStore에 있어서다. 이 구간이 안 잡히면: 내가 Challenge를 누른 직후
      // 상대의 duel:requested가 도착해 수락 시트가 열리고, 뒤이어 내 ack이 성공해
      // duelId/showDuelPending을 덮어써 방금 연 수락 시트가 고아가 된다(리뷰 지적
      // 5번) — 그 상태에서 ack이 DUEL_ALREADY_PENDING 등으로 실패하면 handleException이
      // resetDuel()로 그 고아 상태(=원래는 남의 결투)를 지워버리는 지적 4번으로 이어진다.
      const requestInFlight = useBattleStore.getState().pendingChallengeTargetId != null;
      // 이미 다른 결투가 진행 중이면 새 신청을 받지 않는다 — 서버엔 별도 "거절"을
      // 보내지 않으므로, 신청자 쪽에서는 30초 후 duel:expired로 자연스럽게 정리된다.
      if (isDuelBusy(store) || requestInFlight) return;

      store.setDuelId(payload.duelId);
      store.setDuelRole('recipient');
      store.setChallengerNickname(payload.fromNickname);
      // MiniGame의 승자 판정(handleFinish)이 상대 userId를 필요로 한다 — duel:requested엔
      // team이 없어 nationality는 채우지 못하지만(DuelRequest 시트는 안 씀), userId는 있어야 한다.
      store.setEnemyInfo({
        userId: payload.fromUserId,
        nickname: payload.fromNickname,
        nationality: '',
        distance: ENCOUNTER_RADIUS_M,
      });
      store.setShowDuelRequest(true);
    };

    const handleDuelAccepted = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.setShowDuelPending(false);
      store.setShowDuelRequest(false);
      store.setShowMiniGame(true);
    };

    // 신청 성공 시 BattleEnemyRow가 목록에서 지운 상대를, 거부·만료로 결투가 무산되면
    // 되살린다 — 그러지 않으면 서버가 같은 쌍에 대해 encounter:detected를 재발송하지
    // 않는 60초 쿨다운 동안 목록에서 사라진 채로 남아, 실제로는 지금 바로 재도전
    // 가능한데도 재도전할 방법이 없었다(PR #54 리뷰 지적 11번). 신청자(challenger)
    // 쪽에서만 의미가 있다 — 수신자의 배틀 탭엔 애초에 이 상대가 없었을 수 있다.
    const restoreChallengedEnemy = (store: ReturnType<typeof useOverlayStore.getState>) => {
      if (store.duelRole !== 'challenger' || !store.enemyInfo) return;
      useBattleStore.getState().upsertEnemy({
        userId: store.enemyInfo.userId,
        nickname: store.enemyInfo.nickname,
        team: store.enemyInfo.nationality,
      });
    };

    const handleDuelRejected = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      const wasChallenger = store.duelRole === 'challenger';
      restoreChallengedEnemy(store);
      store.resetDuel();
      // 거부한 당사자에게는 자기 행동을 다시 알려줄 필요가 없다 — 신청자에게만 안내한다.
      if (wasChallenger) Alert.alert(i18n.t('overlay.duelOutcome.title'), i18n.t('overlay.duelOutcome.rejected'));
    };

    const handleDuelExpired = (payload: DuelIdPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      restoreChallengedEnemy(store);
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

  // 미니게임 라운드 이벤트 — 판정은 전부 서버가 하고(PR #46), 클라이언트는 게임 진행과
  // game:submit만 담당한다. duel:accepted 이후 game:start가 도착하기까지의 왕복 구간은
  // MiniGame이 gameType==null을 보고 자체적으로 로딩 화면을 보여준다(별도 show* 플래그 불필요).
  useEffect(() => {
    const handleGameStart = (payload: GameStartPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.startGameRound(payload);
    };

    // 반응속도 게임의 출발 신호 — 대기 시간은 payload에 없다(미리 알면 예측 탭이 가능해진다).
    // goSignal을 증가시켜만 두면 ReactionGame이 그 변화를 보고 스스로 phase를 바꾼다.
    const handleGameGo = (payload: GameRoundPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId || store.gameRound !== payload.round) return;
      store.bumpGoSignal();
    };

    const handleOpponentSubmitted = (payload: GameRoundPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId || store.gameRound !== payload.round) return;
      store.setOpponentSubmitted(true);
    };

    // 동점 재경기 — 곧이어 다음 라운드의 game:start가 오므로, 여기서는 gameType만 비워
    // MiniGame을 "다음 라운드 준비 중" 로딩 화면으로 되돌리고 짧게 안내만 한다.
    const handleRoundResult = (payload: GameRoundResultPayload) => {
      const store = useOverlayStore.getState();
      if (store.duelId !== payload.duelId) return;
      store.clearGameRound();
      Alert.alert(i18n.t('overlay.duelOutcome.title'), i18n.t('overlay.miniGame.rematch'));
    };

    socket.on('game:start', handleGameStart);
    socket.on('game:go', handleGameGo);
    socket.on('game:opponent:submitted', handleOpponentSubmitted);
    socket.on('game:round:result', handleRoundResult);
    return () => {
      socket.off('game:start', handleGameStart);
      socket.off('game:go', handleGameGo);
      socket.off('game:opponent:submitted', handleOpponentSubmitted);
      socket.off('game:round:result', handleRoundResult);
    };
  }, [socket]);

  // 서버가 거절한 요청(사거리 이탈, 페널티, 이미 처리된 결투 등)을 사용자에게 알린다.
  // 이걸 구독하지 않으면 ack가 오지 않는 실패 경로에서 오버레이가 영영 열린 채 멈춘다.
  useEffect(() => {
    const handleException = (payload: WsExceptionPayload) => {
      // DUEL_ 접두사가 아닌 예외(예: location:update 검증 오류, Redis 장애로 인한
      // INTERNAL_SERVER_ERROR)는 결투와 무관하다 — 예전엔 코드와 무관하게 항상 Alert를
      // 띄워, LocationBroadcaster의 60초 하트비트가 실패할 때마다 "결투 실패" 모달이
      // 반복해서 떴다(PR #54 리뷰 지적 2번). 이런 예외는 사용자에게 보여줄 결투 문맥이
      // 없으므로 조용히 무시한다 — pendingChallengeTargetId는 이제 duel:request의 자체
      // .timeout()이 책임지므로(BattleEnemyRow) 더 이상 여기서 비울 필요가 없다.
      if (!payload.code.startsWith('DUEL_')) return;

      const known = `overlay.duelError.${payload.code}`;
      const translated = i18n.t(known);
      // i18n-js는 없는 키에 대해 "[missing ...]" 문자열을 돌려준다 — 아직 매핑하지 않은
      // 코드는 서버가 보낸 메시지로 폴백한다(서버 문구는 한국어 고정).
      const message = translated.startsWith('[missing')
        ? [payload.message].flat().join('\n')
        : translated;

      // duel:request 전용 실패는 "새 결투를 못 열었다"는 뜻이라, 우연히 열려 있는 다른
      // (남의) 결투를 지우면 안 된다(리뷰 지적 4번) — 목록 밖의 DUEL_ 코드만 resetDuel한다.
      if (!DUEL_REQUEST_ONLY_CODES.has(payload.code)) {
        useOverlayStore.getState().resetDuel();
      }

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
