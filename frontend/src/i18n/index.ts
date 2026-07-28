import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import { useSyncExternalStore } from 'react';
import { en } from './locales/en';
import { ko } from './locales/ko';

export type Locale = 'ko' | 'en';

const translations = { ko, en };

const SUPPORTED_LOCALES = Object.keys(translations) as Locale[];
const DEFAULT_LOCALE: Locale = 'en';

function isSupportedLocale(code: string | null | undefined): code is Locale {
  return SUPPORTED_LOCALES.includes(code as Locale);
}

function resolveDeviceLocale(): Locale {
  const match = getLocales().find((l) => isSupportedLocale(l.languageCode));
  return match ? (match.languageCode as Locale) : DEFAULT_LOCALE;
}

export const i18n = new I18n(translations);
i18n.defaultLocale = DEFAULT_LOCALE;
i18n.enableFallback = true;
i18n.locale = resolveDeviceLocale();

export function setLocale(locale: Locale) {
  i18n.locale = locale;
}

function subscribe(onStoreChange: () => void) {
  return i18n.onChange(onStoreChange);
}

function getSnapshot() {
  return i18n.locale;
}

/** 현재 locale의 변경(setLocale)에 반응해 리렌더링되는 번역 훅 */
export function useTranslation() {
  const locale = useSyncExternalStore(subscribe, getSnapshot) as Locale;
  return { t: i18n.t.bind(i18n), locale, setLocale };
}
