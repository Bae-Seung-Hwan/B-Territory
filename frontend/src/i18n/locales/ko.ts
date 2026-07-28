export const ko = {
  onboarding: {
    subtitle: '부산 점령 관광 게임',
    start: '시작하기',
  },
  auth: {
    login: {
      title: '로그인',
      subtitle: 'B-Territory에 오신 것을 환영합니다',
      emailPlaceholder: '이메일',
      passwordPlaceholder: '비밀번호',
      submit: '로그인',
      or: '또는',
      google: 'Google로 계속하기',
      googleComingSoonTitle: '준비 중',
      googleComingSoonMessage: 'Google 로그인은 Firebase 연동 후 지원됩니다.',
      noAccount: '아직 계정이 없으신가요?',
      registerLink: '회원가입 하기',
    },
    register: {
      title: '회원가입',
      subtitle: '닉네임과 국적을 선택하세요',
      nicknamePlaceholder: '닉네임 (2~20자)',
      nationalityLabel: '국적 선택',
      nationalityHint: '같은 국적 관광객과 팀이 됩니다',
      submit: '가입하기',
      nationalities: {
        KR: '한국',
        JP: '일본',
        US: '미국',
        CN: '중국',
        FR: '프랑스',
      },
    },
  },
  tabs: {
    spots: '관광지',
    chat: '채팅',
    map: '지도',
    ranking: '랭킹',
    profile: '내정보',
  },
  spots: {
    title: '관광지',
    placeholder: '지도에 표시되는 관광지 목록이 표시됩니다',
  },
  chat: {
    title: '채팅',
    placeholder: '팀 채팅이 표시됩니다',
  },
  ranking: {
    title: '랭킹',
    placeholder: '국가별 · 개인별 랭킹이 표시됩니다',
  },
  profile: {
    title: '내정보',
    placeholder: '유저 프로필 · 점령 통계가 표시됩니다',
  },
  map: {
    hud: {
      topTeam: '1위 팀',
      capitalDistrict: '이번 주 수도',
    },
  },
  overlay: {
    enemyAlert: {
      title: '적 탐지',
      body: '{{team}} 팀이 {{distance}}m 이내에 있습니다',
      ignore: '무시',
      duel: '결투 신청',
    },
    duelRequest: {
      title: '결투 신청',
      body: '{{team}} 팀에게 결투를 신청합니다',
      hint: '미니게임에서 승리하면 해당 구역을 점령합니다',
      cancel: '취소',
      start: '결투 시작',
    },
    miniGame: {
      title: '미니게임',
      placeholder: '미니게임 UI가 여기에 구현됩니다',
      close: '닫기',
    },
  },
};
