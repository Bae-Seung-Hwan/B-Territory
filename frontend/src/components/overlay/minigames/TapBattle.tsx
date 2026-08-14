import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import type { MiniGameProps } from './types';

const DURATION_SEC = 5;
const WIN_THRESHOLD_TAPS = 15;

export function TapBattle({ onFinish }: MiniGameProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'ready' | 'playing'>('ready');
  const [taps, setTaps] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SEC);
  const tapsRef = useRef(0);
  const finishedRef = useRef(false);

  // taps는 화면 표시용 상태일 뿐이고, 판정은 tapsRef(최신값)로 한다 — 이 effect가
  // taps를 의존성에 넣으면 탭할 때마다 1초 타이머가 재시작돼 카운트다운이 멈춘다.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (secondsLeft <= 0) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish(tapsRef.current >= WIN_THRESHOLD_TAPS);
      }
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, secondsLeft, onFinish]);

  const handleTap = () => {
    tapsRef.current += 1;
    setTaps(tapsRef.current);
  };

  if (phase === 'ready') {
    return (
      <View style={styles.container}>
        <Text style={styles.instruction}>{t('overlay.miniGame.tapBattle.instruction')}</Text>
        <TouchableOpacity style={styles.startBtn} onPress={() => setPhase('playing')}>
          <Text style={styles.startBtnText}>{t('overlay.miniGame.start')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.timer}>{secondsLeft}s</Text>
      <Text style={styles.count}>{t('overlay.miniGame.tapBattle.tapCount', { count: taps })}</Text>
      <TouchableOpacity style={styles.tapBtn} onPress={handleTap} activeOpacity={0.7}>
        <Text style={styles.tapBtnText}>{t('overlay.miniGame.tapBattle.tap')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 20 },
  instruction: { color: '#ccc', fontSize: 15, textAlign: 'center' },
  startBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: BrandColors.accent,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  timer: { color: BrandColors.danger, fontSize: 20, fontWeight: '700' },
  count: { color: '#fff', fontSize: 18, fontWeight: '600' },
  tapBtn: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: BrandColors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapBtnText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});
