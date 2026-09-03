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
    socket.emit(
      'duel:request',
      { targetUserId: enemy.userId },
      (ack: DuelRequestAck) => {
        useBattleStore.getState().setPendingChallengeTargetId(null);
        // 서버가 거부(예: 상대가 이미 다른 결투 중)하면 duelId가 안 온다 — 이 경우
        // 목록에 그대로 남겨 재시도할 수 있게 둔다.
        if (ack.status !== 'ok' || ack.duelId == null) return;

        useOverlayStore.getState().setEnemyInfo({
          userId: enemy.userId,
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
