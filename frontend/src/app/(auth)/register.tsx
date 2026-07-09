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

const NATIONALITIES = [
  { code: 'KR', label: '🇰🇷 한국' },
  { code: 'JP', label: '🇯🇵 일본' },
  { code: 'US', label: '🇺🇸 미국' },
  { code: 'CN', label: '🇨🇳 중국' },
  { code: 'FR', label: '🇫🇷 프랑스' },
];

export default function RegisterScreen() {
  const router = useRouter();
  const { setNickname, setNationality, setAuthenticated } = useUserStore();
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
        <Text style={styles.title}>회원가입</Text>
        <Text style={styles.subtitle}>닉네임과 국적을 선택하세요</Text>

        <TextInput
          style={styles.input}
          placeholder="닉네임 (2~20자)"
          placeholderTextColor="#666"
          value={nickname}
          onChangeText={setNicknameInput}
          maxLength={20}
        />

        <Text style={styles.sectionLabel}>국적 선택</Text>
        <Text style={styles.sectionHint}>같은 국적 관광객과 팀이 됩니다</Text>

        {NATIONALITIES.map((item) => (
          <TouchableOpacity
            key={item.code}
            style={[styles.item, selectedCode === item.code && styles.itemSelected]}
            onPress={() => setSelectedCode(item.code)}
          >
            <Text style={styles.itemText}>{item.label}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitButtonText}>가입하기</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
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
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
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
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    marginBottom: 12,
  },
  itemSelected: { borderColor: '#208AEF', backgroundColor: '#16233A' },
  itemText: { fontSize: 18, color: '#fff', textAlign: 'center' },
  submitButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#208AEF',
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: { backgroundColor: '#2A2A3E' },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
