import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { getCountryList, type Country } from '@/constants/countries';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';

// BottomSheetTextInput의 blur 처리가 RNTextInput.State.currentlyFocusedInput()에
// 의존하는데, react-native-web은 이 메서드를 구현하지 않아 국가 선택 후 시트가
// 닫힐 때 크래시가 난다(@gorhom/bottom-sheet 5.2.14). 네이티브에서만 필요한
// 키보드 연동이므로 web에서는 일반 TextInput으로 대체한다.
const CountrySearchInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

// countryQuery(입력값)를 부모가 아니라 이 컴포넌트가 직접 들고 있는다. 부모가 들고
// 있으면 키 입력마다 ~250개 항목의 BottomSheetFlatList까지 포함한 화면 전체가
// 리렌더링되는데, 이 부하가 네이티브 IME의 한글 조합(모아쓰기) 타이밍과 겹치면서
// 자음/모음이 분리되거나 음절이 중복 커밋되는 문제로 이어진다. 입력값을 이 컴포넌트
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

interface NicknameNationalityFieldsProps {
  nickname: string;
  onNicknameChange: (text: string) => void;
  selectedCode: string | null;
  onSelectCountry: (code: string) => void;
  editable: boolean;
}

/** 닉네임 입력 + 국적 검색/선택 바텀시트. register.tsx와 complete-profile.tsx가 공유한다. */
export function NicknameNationalityFields({
  nickname,
  onNicknameChange,
  selectedCode,
  onSelectCountry,
  editable,
}: NicknameNationalityFieldsProps) {
  const { t, locale } = useTranslation();
  const countrySheetRef = useRef<BottomSheetModal>(null);
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
    onSelectCountry(code);
    countrySheetRef.current?.dismiss();
  };

  return (
    <>
      <TextInput
        style={styles.input}
        placeholder={t('auth.register.nicknamePlaceholder')}
        placeholderTextColor="#666"
        value={nickname}
        onChangeText={onNicknameChange}
        maxLength={20}
        editable={editable}
      />

      <Text style={styles.sectionLabel}>{t('auth.register.nationalityLabel')}</Text>
      <Text style={styles.sectionHint}>{t('auth.register.nationalityHint')}</Text>
      <TouchableOpacity style={styles.dropdown} onPress={openCountryPicker} disabled={!editable}>
        <Text style={selectedCountry ? styles.dropdownValue : styles.dropdownPlaceholder}>
          {selectedCountry
            ? `${selectedCountry.flag} ${selectedCountry.name}`
            : t('auth.register.nationalityPlaceholder')}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </TouchableOpacity>

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
    </>
  );
}

const styles = StyleSheet.create({
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
});
