// 패키지 기본 진입점('main': entry-node.js)은 Node 환경에서 ~90개 로케일 파일을
// 전부 동적 require()로 즉시 로드하는데, 이 패턴을 Metro가 정적으로 해석하지 못해
// SSR(web.output: "static") 빌드가 "Requiring unknown module './langs/br.json'"로
// 깨진다. 우리는 아래에서 en/ko만 수동 등록하므로 그 자동 로딩이 필요 없어
// 가벼운 index 진입점을 직접 import해 우회한다.
import countries from 'i18n-iso-countries/index';
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
