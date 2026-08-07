import { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import type { MiniGameProps } from './types';

const WIN_THRESHOLD_MS = 350;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;

type Phase = 'ready' | 'waiting' | 'go' | 'tooSoon';

export function ReactionGame({ onFinish }: MiniGameProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('ready');
  const goAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startWaiting = () => {
    setPhase('waiting');
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    timeoutRef.current = setTimeout(() => {
      goAtRef.current = Date.now();
      setPhase('go');
    }, delay);
  };

  const handlePress = () => {
    if (phase === 'ready' || phase === 'tooSoon') {
      startWaiting();
    } else if (phase === 'waiting') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setPhase('tooSoon');
    } else if (phase === 'go') {
      const reactionMs = Date.now() - goAtRef.current;
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish(reactionMs <= WIN_THRESHOLD_MS);
      }
    }
  };

  const label =
    phase === 'ready'
      ? t('overlay.miniGame.reaction.instructionWait')
      : phase === 'waiting'
        ? t('overlay.miniGame.reaction.wait')
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
