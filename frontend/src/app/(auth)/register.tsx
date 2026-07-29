import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { isAxiosError } from 'axios';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, User } from 'firebase/auth';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { auth } from '@/lib/firebase';
import { useRegisterMutation } from '@/hooks/use-auth';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { getCountryList, type Country } from '@/constants/countries';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';

// BottomSheetTextInput의 blur 처리가 RNTextInput.State.currentlyFocusedInput()에
// 의존하는데, react-native-web은 이 메서드를 구현하지 않아 국가 선택 후 시트가
// 닫힐 때 크래시가 난다(@gorhom/bottom-sheet 5.2.14). 네이티브에서만 필요한
// 키보드 연동이므로 web에서는 일반 TextInput으로 대체한다.
const CountrySearchInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

// countryQuery(입력값)를 RegisterScreen이 아니라 이 컴포넌트가 직접 들고 있는다.
// RegisterScreen이 들고 있으면 키 입력마다 이메일/비밀번호 필드, ~250개 항목의
// BottomSheetFlatList까지 포함한 화면 전체가 리렌더링되는데, 이 부하가 네이티브
// IME의 한글 조합(모아쓰기) 타이밍과 겹치면서 자음/모음이 분리되거나("ㅎㅏㄱㅜㄱ")
// 음절이 중복 커밋되는("하한하하구구국") 문제로 이어진다. 입력값을 이 컴포넌트
// 안에 격리해 리렌더 범위를 검색창 자신으로만 좁히고, 디바운스된 값만 부모로
// 올려 목록 필터링에 쓴다.
function CountrySearchField({
  placeholder,
  onDebouncedChange,
}: {
  placeholder: string;
  onDebouncedChange: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    onDebouncedChange(deferredQuery);
  }, [deferredQuery, onDebouncedChange]);

  return (
    <CountrySearchInput
      style={styles.searchInput}
      placeholder={placeholder}
      placeholderTextColor="#666"
      value={query}
      onChangeText={setQuery}
      autoCapitalize="none"
    />
  );
}

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
  const { t, locale } = useTranslation();
  const registerMutation = useRegisterMutation();
  const handleAuthError = useHandleAuthError();
  const countrySheetRef = useRef<BottomSheetModal>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNicknameInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFieldKey, setSearchFieldKey] = useState(0);

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const filteredCountries = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    if (!query) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.nameEn.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query),
    );
  }, [countries, debouncedQuery]);
  const selectedCountry = useMemo(
    () => countries.find((c) => c.code === selectedCode) ?? null,
    [countries, selectedCode],
  );

  const openCountryPicker = () => {
    setDebouncedQuery('');
    setSearchFieldKey((key) => key + 1);
    countrySheetRef.current?.present();
  };

  const handleSelectCountry = (code: string) => {
    setSelectedCode(code);
    countrySheetRef.current?.dismiss();
  };

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    password === confirmPassword &&
    nickname.trim().length >= 2 &&
    selectedCode !== null &&
    !registerMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedCode) return;
    try {
      const trimmedEmail = email.trim();

      // Firebase 계정은 이미 있는데 백엔드 프로필이 없는 사용자(이전 가입 시도가 중단됐거나,
      // 로그인 화면에서 404를 받고 넘어온 경우)는 createUserWithEmailAndPassword가
      // auth/email-already-in-use로 막혀 가입을 끝낼 방법이 없었다. 같은 이메일/비밀번호로
      // 로그인이 되면 본인 계정이므로 계정을 새로 만들지 않고 가입만 이어서 진행한다.
      // 남아있는 세션(auth.currentUser)에 기대지 않으므로 앱을 재시작한 뒤에도 복구된다.
      let user: User;
      let createdAccount = false;
      try {
        user = (await createUserWithEmailAndPassword(auth, trimmedEmail, password)).user;
        createdAccount = true;
      } catch (createErr) {
        if ((createErr as { code?: string } | null)?.code !== 'auth/email-already-in-use') {
          throw createErr;
        }
        // 비밀번호가 틀리면 남의 계정이므로 여기서 실패하고 그대로 사용자에게 안내된다.
        user = (await signInWithEmailAndPassword(auth, trimmedEmail, password)).user;
      }
      try {
        // 성공 시 프로필은 mutation의 onSuccess가 queryKeys.auth.me 캐시에 넣는다
        // (진행 중인 조회를 취소한 뒤 넣으므로 뒤늦은 404 응답에 덮이지 않는다).
        // useAuth()가 그 캐시에서 인증 상태를 파생시키므로 스토어 복사는 없다.
        await registerMutation.mutateAsync({
          nickname: nickname.trim(),
          nationality: selectedCode,
        });
        // (main)은 가드되어 있어 인증 상태가 리렌더에 반영되기 전까진 열리지 않으므로,
        // 항상 열려있는 "/"로 보내 index가 판단하게 한다.
        router.replace('/');
      } catch (backendErr) {
        // 백엔드가 4xx로 명확히 거부한 경우(409 제외)에만 서버에 아무 부작용도
        // 없었다고 확신할 수 있어 Firebase 계정을 롤백한다. 네트워크/타임아웃/5xx는
        // 백엔드에 유저 row가 실제로 생겼을 수 있으므로 롤백하지 않는다. 이번 시도로
        // 만든 계정이 아니면(이어서 가입) 남의 계정을 지우는 셈이므로 제외한다.
        const shouldRollback =
          createdAccount &&
          isAxiosError(backendErr) &&
          backendErr.response &&
          backendErr.response.status >= 400 &&
          backendErr.response.status < 500 &&
          backendErr.response.status !== 409;

        if (shouldRollback) {
          try {
            await user.delete();
          } catch (deleteErr) {
            console.warn('Failed to rollback Firebase user after registration failure', deleteErr);
          }
        }
        throw backendErr;
      }
    } catch (err) {
      handleAuthError(err, 'auth.errors.registerFailed');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
          editable={!registerMutation.isPending}
        />
        <PasswordField
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.login.passwordPlaceholder')}
          editable={!registerMutation.isPending}
        />
        <PasswordField
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('auth.register.confirmPasswordPlaceholder')}
          editable={!registerMutation.isPending}
          style={passwordMismatch && styles.inputError}
        />
        {passwordMismatch && (
          <Text style={styles.errorText}>{t('auth.register.passwordMismatch')}</Text>
        )}
        <TextInput
          style={styles.input}
          placeholder={t('auth.register.nicknamePlaceholder')}
          placeholderTextColor="#666"
          value={nickname}
          onChangeText={setNicknameInput}
          maxLength={20}
          editable={!registerMutation.isPending}
        />

        <Text style={styles.sectionLabel}>{t('auth.register.nationalityLabel')}</Text>
        <Text style={styles.sectionHint}>{t('auth.register.nationalityHint')}</Text>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={openCountryPicker}
          disabled={registerMutation.isPending}
        >
          <Text style={selectedCountry ? styles.dropdownValue : styles.dropdownPlaceholder}>
            {selectedCountry
              ? `${selectedCountry.flag} ${selectedCountry.name}`
              : t('auth.register.nationalityPlaceholder')}
          </Text>
          <Text style={styles.dropdownChevron}>▾</Text>
        </TouchableOpacity>

        <Button
          title={t('auth.register.submit')}
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={registerMutation.isPending}
          style={styles.submitButton}
        />
      </ScrollView>

      <BottomSheet ref={countrySheetRef} snapPoints={['75%']} scrollable>
        <CountrySearchField
          key={searchFieldKey}
          placeholder={t('auth.register.nationalitySearchPlaceholder')}
          onDebouncedChange={setDebouncedQuery}
        />
        <BottomSheetFlatList
          data={filteredCountries}
          keyExtractor={(item: Country) => item.code}
          contentContainerStyle={styles.sheetListContent}
          renderItem={({ item }: { item: Country }) => (
            <Card
              onPress={() => handleSelectCountry(item.code)}
              selected={selectedCode === item.code}
              style={[styles.item, selectedCode === item.code && styles.itemSelected]}
            >
              <Text style={styles.itemText}>
                {item.flag} {item.name}
              </Text>
            </Card>
          )}
        />
      </BottomSheet>
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
  dropdown: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownValue: { fontSize: 16, color: '#fff' },
  dropdownPlaceholder: { fontSize: 16, color: '#666' },
  dropdownChevron: { fontSize: 14, color: '#888' },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: BrandColors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    color: '#fff',
    fontSize: 16,
  },
  sheetListContent: { paddingHorizontal: 16, paddingBottom: 24 },
  item: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: BrandColors.background,
    marginBottom: 12,
  },
  itemSelected: { backgroundColor: '#16233A' },
  itemText: { fontSize: 18, color: '#fff', textAlign: 'center' },
  submitButton: { marginTop: 8 },
});
