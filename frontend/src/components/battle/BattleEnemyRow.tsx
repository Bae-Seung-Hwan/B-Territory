import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { Socket } from 'socket.io-client';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useBattleStore, type NearbyEnemy } from '@/store/useBattleStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { ENCOUNTER_RADIUS_M } from '@/constants/game';

interface DuelRequestAck {
  status: string;
  duelId?: number;
}

interface BattleEnemyRowProps {
  enemy: NearbyEnemy;
  socket: Socket | null;
}

export function BattleEnemyRow({ enemy, socket }: BattleEnemyRowProps) {
  // 리스트 전체가 공유하는 pendingChallengeTargetId를 쓴다(로컬 state가 아니다) — duel:request가
  // 서버에서 throw로 끝나면(사거리 이탈·페널티·이미 진행 중인 결투 등) ack 콜백이 아예 호출되지
  // 않고(ws-exception.filter.ts), 그 실패를 알려주는 exception 이벤트엔 어떤 요청에 대한 것인지
  // 구분할 duelId가 없다. 행마다 로컬 pending을 두면 "이 exception이 내 요청 실패다"를 판단할
  // 방법이 없어 아무 행이나 건드리게 된다 — 그래서 애초에 공유 값 하나로 리스트 전체를 막아
  // "동시에 여러 결투를 신청하는 상황" 자체가 생기지 않게 한다. exception 발생 시 이 값을
  // 비우는 처리는 SocketProvider의 전역 handleException이 한다.
  const pendingChallengeTargetId = useBattleStore((s) => s.pendingChallengeTargetId);
  const isPending = pendingChallengeTargetId === enemy.userId;
  const blocked = pendingChallengeTargetId != null;
  const { t } = useTranslation();

  const handleDuel = () => {
    if (!socket || blocked) return;
    useBattleStore.getState().setPendingChallengeTargetId(enemy.userId);
    // .timeout()이 없으면 두 가지 실패 경로에서 이 콜백이 영영 호출되지 않는다 — (1) 서버
    // 핸들러가 throw로 끝나면(사거리 이탈·페널티 등) NestJS가 ack을 아예 보내지 않고
    // exception 이벤트만 오는데, 그 코드가 DUEL_ 접두사가 아니면(Redis 장애로 인한
    // INTERNAL_SERVER_ERROR, 유효성 검증 실패로 인한 BAD_REQUEST 등) 전역 handleException도
    // pendingChallengeTargetId를 비우지 않는다. (2) 소켓이 그 사이 끊기면 socket.io-client의
    // _clearAcks는 .timeout()으로 등록되지 않은(withError가 없는) ack을 에러 호출 없이
    // 조용히 버린다(socket.js#_clearAcks) — 지하철 등에서 끊기면 콜백이 영영 안 온다.
    // 두 경우 모두 앱을 재시작하기 전엔 버튼이 스피너에 갇혔다(PR #54 리뷰 지적 1번).
    // .timeout()을 걸면 서버가 ack을 보내지 않아도 최대 5초 뒤 스스로 에러를 만들어
    // 콜백에 넘기므로, 실패 원인과 무관하게 버튼이 항상 복구된다.
    socket.timeout(5000).emit(
      'duel:request',
      { targetUserId: enemy.userId },
      (err: Error | null, ack?: DuelRequestAck) => {
        useBattleStore.getState().setPendingChallengeTargetId(null);
        // 실패(타임아웃 포함)거나 서버가 거부(예: 상대가 이미 다른 결투 중)해 duelId가
        // 안 왔으면 목록에 그대로 남겨 재시도할 수 있게 둔다. 실패 사유 안내는 exception을
        // 구독하는 SocketProvider가 DUEL_* 코드에 한해 Alert로 담당한다.
        if (err || !ack || ack.status !== 'ok' || ack.duelId == null) return;

        useOverlayStore.getState().setEnemyInfo({
          userId: enemy.userId,
          nickname: enemy.nickname,
          nationality: enemy.team,
          distance: ENCOUNTER_RADIUS_M,
        });
        useOverlayStore.getState().setDuelId(ack.duelId);
        useOverlayStore.getState().setDuelRole('challenger');
        useOverlayStore.getState().setShowDuelPending(true);
        useBattleStore.getState().removeEnemy(enemy.userId);
      },
    );
  };

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.nickname}>{enemy.nickname ?? enemy.userId}</Text>
        <Text style={styles.team}>{enemy.team}</Text>
      </View>
      <TouchableOpacity style={styles.btn} onPress={handleDuel} disabled={blocked}>
        {isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.btnText}>{t('battle.duel')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  info: { gap: 2 },
  nickname: { color: '#fff', fontSize: 15, fontWeight: '600' },
  team: { color: '#888', fontSize: 12 },
  btn: {
    minWidth: 88,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: BrandColors.accent,
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
