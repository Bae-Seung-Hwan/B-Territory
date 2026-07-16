import { useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getAuthErrorMessage } from '@/lib/firebase-errors';
import { useUserStore } from '@/store/useUserStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

const NATIONALITIES = [
  { code: 'KR', flag: '🇰🇷' },
  { code: 'JP', flag: '🇯🇵' },
  { code: 'US', flag: '🇺🇸' },
  { code: 'CN', flag: '🇨🇳' },
  { code: 'FR', flag: '🇫🇷' },
] as const;

export default function RegisterScreen() {
  const router = useRouter();
  const { setUserId, setNickname, setNationality, setAuthenticated } = useUserStore();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNicknameInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    nickname.trim().length >= 2 &&
    selectedCode !== null &&
    !loading;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedCode) return;
    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken();

      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim(), nationality: selectedCode }),
      });
      if (!res.ok) throw new Error(`register failed: ${res.status}`);

      const profile = await res.json();
      setUserId(profile.id);
      setNickname(profile.nickname);
      setNationality(profile.nationality);
      setAuthenticated(true);
      router.replace('/(main)/map');
    } catch (err) {
      Alert.alert(
        t('auth.errors.title'),
        getAuthErrorMessage(err, t, 'auth.errors.registerFailed'),
      );
    } finally {
      setLoading(false);
    }
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
          placeholder={t('auth.login.emailPlaceholder')}
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder={t('auth.login.passwordPlaceholder')}
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder={t('auth.register.nicknamePlaceholder')}
          placeholderTextColor="#666"
          value={nickname}
          onChangeText={setNicknameInput}
          maxLength={20}
          editable={!loading}
        />

        <Text style={styles.sectionLabel}>{t('auth.register.nationalityLabel')}</Text>
        <Text style={styles.sectionHint}>{t('auth.register.nationalityHint')}</Text>

        {NATIONALITIES.map((item) => (
          <TouchableOpacity
            key={item.code}
            style={[styles.item, selectedCode === item.code && styles.itemSelected]}
            onPress={() => setSelectedCode(item.code)}
            disabled={loading}
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
    marginBottom: 12,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    marginTop: 12,
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
