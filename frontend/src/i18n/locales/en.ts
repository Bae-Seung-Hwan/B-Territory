import type { Translations } from '../types';

export const en: Translations = {
  onboarding: {
    subtitle: 'Busan Territory Tour Game',
    start: 'Get Started',
  },
  auth: {
    login: {
      title: 'Log In',
      subtitle: 'Welcome to B-Territory',
      emailPlaceholder: 'Email',
      passwordPlaceholder: 'Password',
      submit: 'Log In',
      or: 'or',
      google: 'Continue with Google',
      googleComingSoonTitle: 'Coming soon',
      googleComingSoonMessage: 'Google login will be supported after Firebase integration.',
      apple: 'Continue with Apple',
      appleComingSoonTitle: 'Coming soon',
      appleComingSoonMessage: 'Apple login will be supported soon.',
      noAccount: "Don't have an account?",
      registerLink: 'Sign up',
    },
    terms: {
      title: 'Agree to Terms',
      subtitle: 'Please agree to the terms below to sign up',
      agreeAll: 'Agree to all',
      serviceTerms: '(Required) Terms of Service',
      privacyPolicy: '(Required) Privacy Policy',
      continue: 'Agree and Continue',
      viewLabel: 'View',
      closeLabel: 'Close',
      serviceTermsTitle: 'Terms of Service',
      serviceTermsBody:
        'Section 1 (Purpose) These terms govern the relationship between the sky and the user regarding the act of counting clouds.\n\n' +
        'Section 2 (Definitions) In these terms, "cat" refers to a concept that only exists on Tuesdays, and "cloud" means any shape the user chooses to imagine.\n\n' +
        'Section 3 (Effect) This document is placeholder text with no real legal effect and will be replaced with the final terms.',
      privacyPolicyTitle: 'Privacy Policy',
      privacyPolicyBody:
        'Section 1 (Collected Data) This service does not collect information about purple feelings, Thursday moods, or a nonexistent sixth finger.\n\n' +
        'Section 2 (Retention) Collected data is retained until a rainbow appears, which is not an actual duration.\n\n' +
        'Section 3 (Effect) This document is placeholder text with no real legal effect and will be replaced with the final privacy policy.',
    },
    register: {
      title: 'Sign Up',
      subtitle: 'Choose a nickname and your nationality',
      nicknamePlaceholder: 'Nickname (2-20 characters)',
      confirmPasswordPlaceholder: 'Confirm password',
      passwordMismatch: 'Passwords do not match',
      nationalityLabel: 'Select nationality',
      nationalityHint: "You'll be teamed up with tourists of the same nationality",
      nationalitySearchPlaceholder: 'Search country',
      nationalityPlaceholder: 'Select a country',
      submit: 'Sign Up',
    },
    session: {
      loadFailed: 'Could not load your account.\nPlease check your network connection.',
      retry: 'Retry',
    },
    emailVerification: {
      hint: 'Email verification is required to sign up. Request the email and tap the link.',
      send: 'Send verification email',
      resendIn: 'Resend available in {{seconds}}s',
      sentTitle: 'Verification email sent',
      sentMessage:
        'Check your inbox and tap the verification link.\nOnce verified, tap Sign Up. (Link valid for 10 minutes)',
      sendFailed: 'Failed to send the verification email.',
      verifyingTitle: 'Verifying email',
      successTitle: 'Email verified',
      successMessage: 'Verification complete.\nReturn to the app to finish signing up.',
      failedTitle: 'Verification failed',
      failedMessage: 'This link is invalid or expired.\nPlease request a new verification email.',
      missingToken: 'This address has no verification token.\nPlease open the link from your email.',
      goToRegister: 'Go to sign up',
    },
    errors: {
      title: 'Error',
      invalidCredential: 'Incorrect email or password',
      tooManyRequests: 'Too many attempts. Please try again later',
      networkError: 'Please check your network connection',
      emailAlreadyInUse: 'This email is already registered',
      weakPassword: 'Password must be at least 6 characters',
      invalidEmail: 'Please enter a valid email address',
      loginFailed: 'Login failed',
      registerFailed: 'Sign up failed',
      sessionExpired: 'Your session has expired. Please log in again',
      alreadyRegistered: 'This account is already registered',
      emailVerificationRequired: 'Email verification required. Please tap the link in the verification email first',
    },
  },
  tabs: {
    spots: 'Spots',
    chat: 'Chat',
    map: 'Map',
    ranking: 'Ranking',
    profile: 'Profile',
  },
  spots: {
    title: 'Spots',
    placeholder: 'The list of spots shown on the map will appear here',
  },
  chat: {
    title: 'Chat',
    placeholder: 'Team chat will appear here',
  },
  ranking: {
    title: 'Ranking',
    placeholder: 'Rankings by country and by player will appear here',
  },
  profile: {
    title: 'Profile',
    placeholder: 'Territory stats coming soon',
    loading: 'Loading…',
    emailLabel: 'Email',
    nationalityLabel: 'Nationality',
    teamLabel: 'Team',
    logout: 'Log Out',
    logoutConfirmTitle: 'Log Out',
    logoutConfirmMessage: 'Are you sure you want to log out?',
    cancel: 'Cancel',
  },
  map: {
    hud: {
      topTeam: 'Top Team',
      capitalDistrict: "This Week's Capital",
    },
  },
  overlay: {
    enemyAlert: {
      title: 'Enemy Detected',
      body: 'Team {{team}} is within {{distance}}m',
      ignore: 'Ignore',
      duel: 'Challenge',
    },
    duelRequest: {
      title: 'Duel Request',
      body: 'Challenging Team {{team}} to a duel',
      hint: 'Winning the mini-game will capture this territory',
      cancel: 'Cancel',
      start: 'Start Duel',
    },
    miniGame: {
      title: 'Mini Game',
      placeholder: 'The mini-game UI will be implemented here',
      close: 'Close',
    },
  },
};
