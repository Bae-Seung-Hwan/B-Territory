import { useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '@/store/useUserStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

const NATIONALITIES = [
  { code: 'KR', flag: '🇰🇷' },
  { code: 'JP', flag: '🇯🇵' },
  { code: 'US', flag: '🇺🇸' },
  { code: 'CN', flag: '🇨🇳' },
  { code: 'FR', flag: '🇫🇷' },
] as const;

export default function RegisterScreen() {
  const router = useRouter();
  const { setNickname, setNationality, setAuthenticated } = useUserStore();
  const { t } = useTranslation();
  const [nickname, setNicknameInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const canSubmit = nickname.trim().length >= 2 && selectedCode !== null;

  const handleSubmit = () => {
    if (!canSubmit || !selectedCode) return;
    // TODO: Firebase Auth 연동 후 POST /api/auth/register 호출로 교체
    setNickname(nickname.trim());
    setNationality(selectedCode);
    setAuthenticated(true);
    router.replace('/(main)/map');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('auth.register.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.register.subtitle')}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('auth.register.nicknamePlaceholder')}
          placeholderTextColor="#666"
          value={nickname}
          onChangeText={setNicknameInput}
          maxLength={20}
        />

        <Text style={styles.sectionLabel}>{t('auth.register.nationalityLabel')}</Text>
        <Text style={styles.sectionHint}>{t('auth.register.nationalityHint')}</Text>

        {NATIONALITIES.map((item) => (
          <TouchableOpacity
            key={item.code}
            style={[styles.item, selectedCode === item.code && styles.itemSelected]}
            onPress={() => setSelectedCode(item.code)}
          >
            <Text style={styles.itemText}>
              {item.flag} {t(`auth.register.nationalities.${item.code}`)}
            </Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitButtonText}>{t('auth.register.submit')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  content: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: '#888', marginTop: 8, marginBottom: 24 },
  input: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    color: '#fff',
    fontSize: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  sectionHint: {
    alignSelf: 'flex-start',
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    marginBottom: 12,
  },
  item: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    marginBottom: 12,
  },
  itemSelected: { borderColor: BrandColors.accent, backgroundColor: '#16233A' },
  itemText: { fontSize: 18, color: '#fff', textAlign: 'center' },
  submitButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: BrandColors.accent,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: { backgroundColor: BrandColors.border },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
