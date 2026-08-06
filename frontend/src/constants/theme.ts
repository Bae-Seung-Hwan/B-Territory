/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// 게임 화면(온보딩/인증/지도/오버레이 등) 전용 다크 팔레트 — 위 Colors(light/dark)와 별개로,
// 항상 다크로 고정된 브랜드 톤. 14개 파일에 흩어져 있던 하드코딩 값을 여기로 통합한다.
export const BrandColors = {
  background: '#0A0A0F',
  surface: '#1A1A2E',
  border: '#2A2A3E',
  accent: '#208AEF',
  danger: '#FF4444',
} as const;

/**
 * #rrggbb + 0~1 알파 → rgba() 문자열.
 *
 * 반투명 표현이 세 갈래로 흩어져 있던 것을 하나로 모은 것이다 — hex 접미사(`${color}D9`),
 * rgba 리터럴, 그리고 DistrictPolygons 안의 지역 헬퍼. 접미사 방식은 `D9`가 몇 %인지 읽히지
 * 않아 매번 주석이 따라붙었고 6자리 hex에만 동작했다. react-native-maps의 fillColor/strokeColor는
 * 8자리 hex 지원이 플랫폼별로 엇갈리는 반면 rgba() 문자열은 어디서나 통해, RN StyleSheet와
 * 지도 prop 양쪽에 같은 헬퍼를 쓸 수 있다.
 */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
