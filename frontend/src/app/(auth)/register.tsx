import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isAxiosError } from 'axios';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { auth } from '@/lib/firebase';
import { getAuthErrorMessage } from '@/lib/firebase-errors';
import { getApiErrorMessage } from '@/lib/api-errors';
import { useRegisterMutation } from '@/hooks/use-auth';
import { useUserStore } from '@/store/useUserStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { getCountryList, type Country } from '@/constants/countries';

export default function RegisterScreen() {
  const router = useRouter();
  const { setUserId, setNickname, setNationality, setAuthenticated } = useUserStore();
  const { t, locale } = useTranslation();
  const registerMutation = useRegisterMutation();
  const countrySheetRef = useRef<BottomSheetModal>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNicknameInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // 검색어 입력(한글 조합)과 리스트 재필터링을 분리한다. 매 타이핑마다 ~250개국
  // 목록 전체를 재필터링해 BottomSheetFlatList를 리렌더링하면, 그 부하가 IME의
  // 한글 조합(모아쓰기) 처리를 방해해 자음/모음이 분리된 채로 커밋되는 문제가 있었다.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(countryQuery), 200);
    return () => clearTimeout(timer);
  }, [countryQuery]);

  const countries = useMemo(() => getCountryList(locale), [locale]);
  const filteredCountries = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    if (!query) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query),
    );
  }, [countries, debouncedQuery]);
  const selectedCountry = countries.find((c) => c.code === selectedCode) ?? null;

  const openCountryPicker = () => {
    setCountryQuery('');
    setDebouncedQuery('');
    countrySheetRef.current?.present();
  };

  const handleSelectCountry = (code: string) => {
    setSelectedCode(code);
    countrySheetRef.current?.dismiss();
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    [],
  );

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    nickname.trim().length >= 2 &&
    selectedCode !== null &&
    !registerMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedCode) return;
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
      try {
        const profile = await registerMutation.mutateAsync({
          nickname: nickname.trim(),
          nationality: selectedCode,
        });
        setUserId(profile.id);
        setNickname(profile.nickname);
        setNationality(profile.nationality);
        setAuthenticated(true);
        router.replace('/(main)/map');
      } catch (backendErr) {
        // 백엔드 실패 시 Firebase 계정도 롤백해 중간 상태 방지
        await user.delete();
        throw backendErr;
      }
    } catch (err) {
      Alert.alert(
        t('auth.errors.title'),
        isAxiosError(err)
          ? getApiErrorMessage(err, t, 'auth.errors.registerFailed')
          : getAuthErrorMessage(err, t, 'auth.errors.registerFailed'),
      );
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
        <TextInput
          style={styles.input}
          placeholder={t('auth.login.passwordPlaceholder')}
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!registerMutation.isPending}
        />
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

        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitButtonText}>{t('auth.register.submit')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <BottomSheetModal
        ref={countrySheetRef}
        snapPoints={['75%']}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder={t('auth.register.nationalitySearchPlaceholder')}
          placeholderTextColor="#666"
          value={countryQuery}
          onChangeText={setCountryQuery}
          autoCapitalize="none"
        />
        <BottomSheetFlatList
          data={filteredCountries}
          keyExtractor={(item: Country) => item.code}
          contentContainerStyle={styles.sheetListContent}
          renderItem={({ item }: { item: Country }) => (
            <TouchableOpacity
              style={[styles.item, selectedCode === item.code && styles.itemSelected]}
              onPress={() => handleSelectCountry(item.code)}
            >
              <Text style={styles.itemText}>
                {item.flag} {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      </BottomSheetModal>
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
  sheetBackground: { backgroundColor: BrandColors.surface },
  sheetHandle: { backgroundColor: BrandColors.border },
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
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: BrandColors.background,
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
