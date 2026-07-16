import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getAuthErrorMessage } from '@/lib/firebase-errors';
import { useUserStore } from '@/store/useUserStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export default function LoginScreen() {
  const router = useRouter();
  const { setAuthenticated, setUserId, setNickname, setNationality } = useUserStore();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleLogin = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken();

      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (res.status === 404) {
        // Firebase 계정은 있지만 백엔드 프로필이 없음 (가입 미완료)
        router.replace('/(auth)/register');
        return;
      }
      if (!res.ok) throw new Error(`me failed: ${res.status}`);

      const profile = await res.json();
      setUserId(profile.id);
      setNickname(profile.nickname);
      setNationality(profile.nationality);
      setAuthenticated(true);
      router.replace('/(main)/map');
    } catch (err) {
      Alert.alert(t('auth.errors.title'), getAuthErrorMessage(err, t, 'auth.errors.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    Alert.alert(t('auth.login.googleComingSoonTitle'), t('auth.login.googleComingSoonMessage'));
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>{t('auth.login.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>

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

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={!canSubmit}
      >
        <Text style={styles.buttonText}>{t('auth.login.submit')}</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t('auth.login.or')}</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin}>
        <Text style={styles.googleButtonText}>{t('auth.login.google')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.registerLink}
        onPress={() => router.push('/(auth)/register')}
      >
        <Text style={styles.registerLinkText}>
          {t('auth.login.noAccount')}{' '}
          <Text style={styles.registerLinkAccent}>{t('auth.login.registerLink')}</Text>
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: BrandColors.background,
    paddingHorizontal: 24,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
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
  button: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: BrandColors.accent,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: BrandColors.border },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BrandColors.border },
  dividerText: { color: '#666', fontSize: 12, marginHorizontal: 12 },
  googleButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  googleButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  registerLink: { marginTop: 24, alignItems: 'center' },
  registerLinkText: { color: '#888', fontSize: 14 },
  registerLinkAccent: { color: BrandColors.accent, fontWeight: '600' },
});
