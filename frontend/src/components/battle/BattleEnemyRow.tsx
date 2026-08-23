import { useState } from 'react';
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
  const [pending, setPending] = useState(false);
  const { t } = useTranslation();

  const handleDuel = () => {
    if (!socket || pending) return;
    setPending(true);
    socket.emit(
      'duel:request',
      { targetUserId: enemy.userId },
      (ack: DuelRequestAck) => {
        setPending(false);
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
      <TouchableOpacity style={styles.btn} onPress={handleDuel} disabled={pending}>
        {pending ? (
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
