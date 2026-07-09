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
import { useUserStore } from '@/store/useUserStore';

export default function LoginScreen() {
  const router = useRouter();
  const setAuthenticated = useUserStore((s) => s.setAuthenticated);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const handleLogin = () => {
    if (!canSubmit) return;
    // TODO: Firebase Auth 연동 후 실제 로그인 요청으로 교체
    setAuthenticated(true);
    router.replace('/(main)/map');
  };

  const handleGoogleLogin = () => {
    Alert.alert('준비 중', 'Google 로그인은 Firebase 연동 후 지원됩니다.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>로그인</Text>
      <Text style={styles.subtitle}>B-Territory에 오신 것을 환영합니다</Text>

      <TextInput
        style={styles.input}
        placeholder="이메일"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호"
        placeholderTextColor="#666"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={!canSubmit}
      >
        <Text style={styles.buttonText}>로그인</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>또는</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin}>
        <Text style={styles.googleButtonText}>Google로 계속하기</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.registerLink}
        onPress={() => router.push('/(auth)/register')}
      >
        <Text style={styles.registerLinkText}>
          아직 계정이 없으신가요? <Text style={styles.registerLinkAccent}>회원가입 하기</Text>
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#0A0A0F',
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
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#208AEF',
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: '#2A2A3E' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2A2A3E' },
  dividerText: { color: '#666', fontSize: 12, marginHorizontal: 12 },
  googleButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A3E',
  },
  googleButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  registerLink: { marginTop: 24, alignItems: 'center' },
  registerLinkText: { color: '#888', fontSize: 14 },
  registerLinkAccent: { color: '#208AEF', fontWeight: '600' },
});
