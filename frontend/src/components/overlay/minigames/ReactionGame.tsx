import { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import type { MiniGameSubmit } from './types';

interface ReactionGameProps {
  /**
   * game:go 수신마다 증가하는 카운터(useOverlayStore#goSignal). 대기 시간은 서버가 정하고
   * 클라에 알려주지 않으므로(미리 알면 예측 탭이 가능해진다), 신호가 오기 전까지는 언제
   * 켜질지 전혀 알 수 없다 — 로컬 setTimeout으로 스스로 신호를 만들면 반응 시간을
   * 클라이언트가 아무 값이나 주장할 수 있게 되어 서버 판정의 의미가 없어진다.
   */
  goSignal: number;
  onSubmit: MiniGameSubmit;
}

type Phase = 'waiting' | 'go' | 'tooSoon';

export function ReactionGame({ goSignal, onSubmit }: ReactionGameProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('waiting');
  const submittedRef = useRef(false);
  // 마운트 시점의 goSignal을 기준선으로 잡아, 그 이후의 변화(= 이번 라운드의 game:go)에만
  // 반응한다 — 값 자체가 아니라 "바뀌었다"는 사실이 신호다.
  const baselineRef = useRef(goSignal);

  useEffect(() => {
    if (goSignal !== baselineRef.current) setPhase('go');
  }, [goSignal]);

  const handlePress = () => {
    if (phase === 'waiting') {
      // game:go 전에 보낸 제출은 서버가 부정출발로 최하점 처리한다(재제출도 안 됨) — 그래서
      // 신호 전 탭은 서버로 보내지 않고 로컬에서만 "너무 빨랐어요"로 잡는다.
      setPhase('tooSoon');
    } else if (phase === 'tooSoon') {
      setPhase('waiting');
    } else if (phase === 'go') {
      if (!submittedRef.current) {
        submittedRef.current = true;
        onSubmit();
      }
    }
  };

  const label =
    phase === 'waiting'
      ? t('overlay.miniGame.reaction.instructionWait')
      : phase === 'tooSoon'
        ? t('overlay.miniGame.reaction.tooSoon')
        : t('overlay.miniGame.reaction.go');

  return (
    <TouchableOpacity
      style={[styles.container, phase === 'go' && styles.goBackground]}
      activeOpacity={1}
      onPress={handlePress}
    >
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 260,
    height: 260,
    borderRadius: 20,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  goBackground: { backgroundColor: '#1E7A3C', borderColor: '#1E7A3C' },
  label: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
