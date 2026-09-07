import { renderHook, act } from '@testing-library/react-native';
import { i18n, useTranslation } from '@/i18n';

describe('i18n', () => {
  afterEach(async () => {
    await act(() => {
      i18n.locale = 'ko';
    });
  });

  it('translates a simple key in the current locale', () => {
    i18n.locale = 'ko';
    expect(i18n.t('tabs.battle')).toBe('배틀');

    i18n.locale = 'en';
    expect(i18n.t('tabs.battle')).toBe('Battle');
  });

  it('interpolates placeholders', () => {
    i18n.locale = 'en';
    expect(i18n.t('overlay.duelPending.body', { team: 'KR' })).toBe(
      'You challenged Team KR to a duel',
    );
  });

  // SocketProvider의 exception 핸들러가 "매핑되지 않은 에러 코드"를 이 접두사로 판별해
  // 서버 메시지로 폴백한다 — 형식이 바뀌면 매핑된 코드까지 폴백으로 새므로 고정해둔다.
  it('maps known WS duel error codes and marks unknown ones as missing', () => {
    i18n.locale = 'en';
    expect(i18n.t('overlay.duelError.DUEL_OUT_OF_RANGE')).toBe('Your opponent is too far away');
    expect(i18n.t('overlay.duelError.NOT_A_REAL_CODE')).toMatch(/^\[missing/);
  });

  it('falls back to defaultLocale for unsupported locales', () => {
    i18n.locale = 'fr';
    expect(i18n.t('tabs.battle')).toBe('Battle'); // defaultLocale is 'en'
  });

  it('useTranslation re-renders components when the locale changes', async () => {
    const { result } = await renderHook(() => useTranslation());

    await act(() => {
      result.current.setLocale('ko');
    });
    expect(result.current.t('tabs.chat')).toBe('채팅');

    await act(() => {
      result.current.setLocale('en');
    });
    expect(result.current.locale).toBe('en');
    expect(result.current.t('tabs.chat')).toBe('Chat');
  });
});
