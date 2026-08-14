import type { Translations } from '../types';

export const en: Translations = {
  common: {
    cancel: 'Cancel',
    close: 'Close',
  },
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
    completeProfile: {
      title: 'Complete your profile',
      subtitle: "Just a nickname and your nationality, and you're ready to go",
      submit: 'Get Started',
    },
    session: {
      loadFailed: 'Could not load your account.\nPlease check your network connection.',
      retry: 'Retry',
    },
    emailVerification: {
      send: 'Send verification email',
      resendIn: 'Resend available in {{seconds}}s',
      sentTitle: 'Verification email sent',
      sentMessage:
        'Check your inbox and tap the verification link.\nOnce verified, tap "I\'ve verified my email".',
      sendFailed: 'Failed to send the verification email.',
      pendingTitle: 'Verify your email',
      pendingMessage:
        'We sent a verification email to {{email}}.\nTap the link in the email, then press the button below.',
      confirmButton: "I've verified my email",
      notYetTitle: 'Not verified yet',
      notYetMessage: 'Please tap the verification link in your email first, then try again.',
      changeEmail: 'Use a different email',
      changeEmailConfirmTitle: 'Sign up with a different email?',
      changeEmailConfirmMessage:
        "The account created with this email will be deleted, and you'll need to start over.",
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
    disabledBanner: 'Chat server integration coming soon',
    emptyState: 'No messages yet',
    inputPlaceholder: 'Type a message',
    send: 'Send',
    shareLocation: "I'm here",
    locationShared: '{{nickname}} is at {{spot}}',
    locationSharedUnknown: '{{nickname}} shared their location',
    you: 'Me',
    errors: {
      connection: 'Chat connection failed. Retrying…',
      rateLimit: 'You sent messages too quickly. Please try again shortly',
      unknown: 'Failed to send message',
    },
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
  },
  map: {
    hud: {
      topTeam: 'Top Team',
      capitalDistrict: "This Week's Capital",
    },
    outOfBounds: 'Current location is not in Busan',
    spotsLoadError: 'Failed to load tourist spots · Tap to retry',
    categories: {
      '12': 'Attractions',
      '14': 'Culture',
      '15': 'Festivals & Events',
      '25': 'Travel Courses',
      '28': 'Leisure Sports',
      '32': 'Lodging',
      '38': 'Shopping',
      '39': 'Restaurants',
      default: 'Other',
    },
    callout: {
      address: 'Address',
      claimStatus: 'Claim status',
    },
    claim: {
      claimedBy: 'Claimed by {{team}}',
      unclaimed: 'Unclaimed',
      loadFailed: 'Failed to load claim status',
    },
    districtDetail: {
      claimTeam: 'Holding team',
      claimedAt: 'Claimed at',
      notAggregated: 'Never claimed',
      scoreWeight: 'Score weight',
      loadFailed: 'Failed to load district info',
      retry: 'Retry',
    },
    spotDetail: {
      loadFailed: 'Failed to load details',
      retry: 'Retry',
      usetime: 'Hours',
      homepage: 'Website',
      noOverview: 'No description available',
    },
    missions: {
      GPS_VISIT: {
        button: 'Claim this spot',
        rejected: 'You must be within 50m of the spot to claim it',
        blocked: 'Getting your location…',
      },
    },
    claimAttempt: {
      success: 'Claimed! +{{points}} pts',
      loginRequired: 'Sign in required',
      penalty: 'You cannot claim while under a duel-loss penalty',
      spotNotFound: 'Spot not found',
      dailyLimit: 'You already claimed this spot today (resets at midnight KST)',
      failed: 'Claim failed',
    },
    categoryFilter: {
      title: 'Categories',
      all: 'All',
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
      start: 'Start Duel',
    },
    miniGame: {
      title: 'Mini Game',
      placeholder: 'The mini-game UI will be implemented here',
    },
  },
};
