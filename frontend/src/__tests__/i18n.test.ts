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
    expect(i18n.t('tabs.spots')).toBe('관광지');

    i18n.locale = 'en';
    expect(i18n.t('tabs.spots')).toBe('Spots');
  });

  it('interpolates placeholders', () => {
    i18n.locale = 'en';
    expect(i18n.t('overlay.enemyAlert.body', { team: 'KR', distance: 42 })).toBe(
      'Team KR is within 42m',
    );
  });

  it('falls back to defaultLocale for unsupported locales', () => {
    i18n.locale = 'fr';
    expect(i18n.t('tabs.spots')).toBe('Spots'); // defaultLocale is 'en'
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
