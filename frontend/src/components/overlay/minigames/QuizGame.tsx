import { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import type { LocalizedText } from '@/store/useOverlayStore';
import type { MiniGameSubmit } from './types';

interface QuizGameProps {
  /** 정답은 서버 세션에만 있다 — 여기서 채점하지 않는다(구 버전은 정답이 항상 선택지 1번이었다). */
  question: LocalizedText;
  choices: LocalizedText[];
  onSubmit: MiniGameSubmit;
}

export function QuizGame({ question, choices, onSubmit }: QuizGameProps) {
  const { t, locale } = useTranslation();
  const submittedRef = useRef(false);

  const handleSelect = (index: number) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(index);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.instruction}>{t('overlay.miniGame.quiz.instruction')}</Text>
      <Text style={styles.question}>{question[locale]}</Text>
      <View style={styles.choices}>
        {choices.map((choice, index) => (
          <TouchableOpacity key={index} style={styles.choiceBtn} onPress={() => handleSelect(index)}>
            <Text style={styles.choiceText}>{choice[locale]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 16, width: '100%' },
  instruction: { color: '#ccc', fontSize: 14 },
  question: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  choices: { width: '100%', gap: 12, marginTop: 8 },
  choiceBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    alignItems: 'center',
  },
  choiceText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
