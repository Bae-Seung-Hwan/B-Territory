type Translate = (scope: string) => string;

/** Firebase Auth 에러 코드를 i18n 메시지로 매핑. 알 수 없는 코드는 fallbackKey로 폴백. */
export function getAuthErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const code = (error as { code?: string } | null)?.code;

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return t('auth.errors.invalidCredential');
    case 'auth/too-many-requests':
      return t('auth.errors.tooManyRequests');
    case 'auth/network-request-failed':
      return t('auth.errors.networkError');
    case 'auth/email-already-in-use':
      return t('auth.errors.emailAlreadyInUse');
    case 'auth/weak-password':
      return t('auth.errors.weakPassword');
    case 'auth/invalid-email':
      return t('auth.errors.invalidEmail');
    default:
      return t(fallbackKey);
  }
}
