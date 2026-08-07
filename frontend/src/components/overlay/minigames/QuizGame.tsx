import { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import type { MiniGameProps } from './types';

const CORRECT_CHOICE_INDEX = 0;

export function QuizGame({ onFinish }: MiniGameProps) {
  const { t } = useTranslation();
  const finishedRef = useRef(false);

  const choices = [
    t('overlay.miniGame.quiz.choice1'),
    t('overlay.miniGame.quiz.choice2'),
    t('overlay.miniGame.quiz.choice3'),
    t('overlay.miniGame.quiz.choice4'),
  ];

  const handleSelect = (index: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(index === CORRECT_CHOICE_INDEX);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.instruction}>{t('overlay.miniGame.quiz.instruction')}</Text>
      <Text style={styles.question}>{t('overlay.miniGame.quiz.question')}</Text>
      <View style={styles.choices}>
        {choices.map((choice, index) => (
          <TouchableOpacity key={choice} style={styles.choiceBtn} onPress={() => handleSelect(index)}>
            <Text style={styles.choiceText}>{choice}</Text>
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
