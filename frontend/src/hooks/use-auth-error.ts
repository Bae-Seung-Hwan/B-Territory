import { Alert } from 'react-native';
import { isAxiosError } from 'axios';
import { getAuthErrorMessage } from '@/lib/firebase-errors';
import { getApiErrorMessage } from '@/lib/api-errors';
import { useTranslation } from '@/i18n';

export function useHandleAuthError() {
  const { t } = useTranslation();
  return (err: unknown, fallbackKey: string) => {
    Alert.alert(
      t('auth.errors.title'),
      isAxiosError(err)
        ? getApiErrorMessage(err, t, fallbackKey)
        : getAuthErrorMessage(err, t, fallbackKey),
    );
  };
}
