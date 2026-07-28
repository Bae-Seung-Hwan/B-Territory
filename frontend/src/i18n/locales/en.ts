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
      noAccount: "Don't have an account?",
      registerLink: 'Sign up',
    },
    register: {
      title: 'Sign Up',
      subtitle: 'Choose a nickname and your nationality',
      nicknamePlaceholder: 'Nickname (2-20 characters)',
      nationalityLabel: 'Select nationality',
      nationalityHint: "You'll be teamed up with tourists of the same nationality",
      submit: 'Sign Up',
      nationalities: {
        KR: 'Korea',
        JP: 'Japan',
        US: 'United States',
        CN: 'China',
        FR: 'France',
      },
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
