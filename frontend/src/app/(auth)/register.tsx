import { useState } from 'react';
import {
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '@/lib/firebase';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useRegistrationFlow } from '@/hooks/use-registration-flow';
import { useRegisterDraft } from '@/hooks/use-register-draft';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { NicknameNationalityFields } from '@/components/auth/NicknameNationalityFields';

function PasswordField({
  value,
  onChangeText,
  placeholder,
  editable,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.passwordWrapper}>
      <TextInput
        style={[styles.input, styles.passwordInput, style]}
        placeholder={placeholder}
        placeholderTextColor="#666"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        editable={editable}
      />
      <TouchableOpacity
        style={styles.passwordToggle}
        onPress={() => setVisible((prev) => !prev)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name={visible ? 'eye-outline' : 'eye-off-outline'} size={20} color="#888" />
      </TouchableOpacity>
    </View>
  );
}

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const handleAuthError = useHandleAuthError();
  const {
    step,
    submit,
    confirmVerification,
    resendVerificationEmail,
    changeEmail,
    isSubmitting,
    isCheckingVerification,
    isChangingEmail,
    isRegistering,
    isSendingVerification,
    hasSentVerification,
    verificationCooldown,
  } = useRegistrationFlow({ onRegistered: () => router.replace('/') });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNicknameInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // 이메일 인증 때문에 앱을 벗어났다 돌아와도 다시 입력하지 않도록 초안을 보관한다.
  // 비밀번호는 담기지 않으므로 복원 후에도 다시 입력해야 한다.
  useRegisterDraft({
    email,
    nickname,
    nationality: selectedCode,
    onRestore: (draft) => {
      setEmail(draft.email);
      setNicknameInput(draft.nickname);
      setSelectedCode(draft.nationality);
    },
  });

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const isBusy = isSubmitting || isCheckingVerification || isRegistering || isChangingEmail;

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    password === confirmPassword &&
    nickname.trim().length >= 2 &&
    selectedCode !== null &&
    !isBusy;

  const canConfirm = nickname.trim().length >= 2 && selectedCode !== null && !isBusy;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedCode) return;
    try {
      const result = await submit(email.trim(), password, nickname.trim(), selectedCode);
      if (result === 'verificationSendFailed') {
        Alert.alert(t('auth.errors.title'), t('auth.emailVerification.sendFailed'));
      }
    } catch (err) {
      handleAuthError(err, 'auth.errors.registerFailed');
    } finally {
      // 계정이 생겼든 실패했든, 방금 시도한 비밀번호를 평문으로 오래 남겨둘 이유가
      // 없다 — 인증 대기 단계로 넘어갔다면 더 이상 필요 없고, 실패했다면 다시
      // 입력받는 편이 안전하다.
      setPassword('');
      setConfirmPassword('');
    }
  };

  const handleConfirmVerification = async () => {
    if (!canConfirm || !selectedCode) return;
    try {
      const result = await confirmVerification(nickname.trim(), selectedCode);
      if (result === 'not-verified') {
        Alert.alert(
          t('auth.emailVerification.notYetTitle'),
          t('auth.emailVerification.notYetMessage'),
        );
      } else if (result === 'no-session') {
        Alert.alert(t('auth.errors.title'), t('auth.errors.sessionExpired'));
      }
    } catch (err) {
      handleAuthError(err, 'auth.errors.registerFailed');
    }
  };

  const handleResend = async () => {
    try {
      const sent = await resendVerificationEmail();
      if (!sent) return;
      Alert.alert(t('auth.emailVerification.sentTitle'), t('auth.emailVerification.sentMessage'));
    } catch (err) {
      handleAuthError(err, 'auth.emailVerification.sendFailed');
    }
  };

  const handleChangeEmail = () => {
    Alert.alert(
      t('auth.emailVerification.changeEmailConfirmTitle'),
      t('auth.emailVerification.changeEmailConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auth.emailVerification.changeEmail'),
          style: 'destructive',
          onPress: async () => {
            try {
              await changeEmail();
              setEmail('');
              setPassword('');
              setConfirmPassword('');
            } catch (err) {
              handleAuthError(err, 'auth.errors.registerFailed');
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('auth.register.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.register.subtitle')}</Text>

        {step === 'form' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('auth.login.emailPlaceholder')}
              placeholderTextColor="#666"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!isBusy}
            />
            <PasswordField
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.login.passwordPlaceholder')}
              editable={!isBusy}
            />
            <PasswordField
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('auth.register.confirmPasswordPlaceholder')}
              editable={!isBusy}
              style={passwordMismatch && styles.inputError}
            />
            {passwordMismatch && (
              <Text style={styles.errorText}>{t('auth.register.passwordMismatch')}</Text>
            )}
          </>
        ) : (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingTitle}>{t('auth.emailVerification.pendingTitle')}</Text>
            <Text style={styles.pendingMessage}>
              {t('auth.emailVerification.pendingMessage', {
                email: auth.currentUser?.email ?? '',
              })}
            </Text>
            <Button
              title={
                verificationCooldown > 0
                  ? t('auth.emailVerification.resendIn', { seconds: verificationCooldown })
                  : t('auth.emailVerification.send')
              }
              onPress={handleResend}
              variant="secondary"
              disabled={verificationCooldown > 0 || isBusy}
              loading={isSendingVerification}
              style={styles.verifyButton}
            />
            {hasSentVerification && (
              <Text style={styles.verifySent}>{t('auth.emailVerification.sentMessage')}</Text>
            )}
            <Button
              title={t('auth.emailVerification.changeEmail')}
              onPress={handleChangeEmail}
              variant="danger"
              disabled={isBusy}
              loading={isChangingEmail}
              style={styles.changeEmailButton}
            />
          </View>
        )}

        {/* 닉네임/국적은 두 단계 모두에서 노출한다 — 인증 대기 중 앱이 꺼졌다 재시작돼도
            초안(최대 24시간 보관)이 만료돼 비어있을 수 있는데, 여기서 바로 채워 넣으면
            폼 단계로 되돌아갈 필요 없이 이어서 완료할 수 있다. */}
        <NicknameNationalityFields
          nickname={nickname}
          onNicknameChange={setNicknameInput}
          selectedCode={selectedCode}
          onSelectCountry={setSelectedCode}
          editable={!isBusy}
        />

        <Button
          title={
            step === 'form' ? t('auth.register.submit') : t('auth.emailVerification.confirmButton')
          }
          onPress={step === 'form' ? handleSubmit : handleConfirmVerification}
          disabled={step === 'form' ? !canSubmit : !canConfirm}
          loading={isRegistering || (step === 'form' ? isSubmitting : isCheckingVerification)}
          style={styles.submitButton}
        />
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
  inputError: { borderColor: BrandColors.danger },
  pendingBox: { width: '100%', marginBottom: 12 },
  pendingTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 6 },
  pendingMessage: {
    fontSize: 13,
    color: '#ccc',
    lineHeight: 19,
    marginBottom: 12,
  },
  verifyButton: { marginBottom: 12 },
  changeEmailButton: { marginTop: 4 },
  verifySent: {
    alignSelf: 'flex-start',
    fontSize: 12,
    color: BrandColors.accent,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 12,
  },
  errorText: {
    alignSelf: 'flex-start',
    fontSize: 12,
    color: BrandColors.danger,
    marginTop: -8,
    marginBottom: 12,
  },
  passwordWrapper: { width: '100%', marginBottom: 12 },
  passwordInput: { marginBottom: 0, paddingRight: 44 },
  passwordToggle: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  submitButton: { marginTop: 8 },
});
