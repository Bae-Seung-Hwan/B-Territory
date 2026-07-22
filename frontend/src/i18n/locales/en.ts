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
    register: {
      title: 'Sign Up',
      subtitle: 'Choose a nickname and your nationality',
      nicknamePlaceholder: 'Nickname (2-20 characters)',
      nationalityLabel: 'Select nationality',
      nationalityHint: "You'll be teamed up with tourists of the same nationality",
      nationalitySearchPlaceholder: 'Search country',
      nationalityPlaceholder: 'Select a country',
      submit: 'Sign Up',
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
    placeholder: 'User profile and territory stats will appear here',
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
