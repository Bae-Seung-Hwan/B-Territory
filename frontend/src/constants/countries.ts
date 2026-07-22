import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import ko from 'i18n-iso-countries/langs/ko.json';
import type { Locale } from '@/i18n';

countries.registerLocale(en);
countries.registerLocale(ko);

export type Country = {
  code: string;
  name: string;
  flag: string;
};

/** ISO 3166-1 alpha-2 코드를 지역표시문자(Regional Indicator Symbol) 유니코드 플래그로 변환 */
function codeToFlagEmoji(code: string): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((char) => 127397 + char.charCodeAt(0)),
  );
}

/** 전세계 국가 목록을 주어진 로케일의 이름으로 정렬해 반환 */
export function getCountryList(locale: Locale): Country[] {
  const names = countries.getNames(locale);
  return Object.entries(names)
    .map(([code, name]) => ({ code, name, flag: codeToFlagEmoji(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
