/**
 * 결투 미니게임 퀴즈 문제은행.
 *
 * 정답을 서버에만 두는 것이 핵심이다 — 프론트에 문제와 정답이 함께 있으면(구 QuizGame은
 * 정답이 항상 첫 번째 선택지였다) 판정 자체가 무의미해진다. 서버는 game:start에 선택지를
 * 셔플해서 내려주고, 셔플 후 정답 위치는 세션에만 보관한다.
 *
 * 소켓에는 언어 파라미터가 없어(핸드셰이크에 lang이 없다) ko/en을 모두 실어 보내고
 * 표시할 언어는 클라이언트의 i18n이 고른다.
 */
export interface LocalizedText {
  ko: string;
  en: string;
}

export interface QuizQuestion {
  id: string;
  question: LocalizedText;
  /** answerIndex는 이 원본 배열 기준. 세션 생성 시 셔플되므로 클라이언트에 그대로 나가지 않는다. */
  choices: LocalizedText[];
  answerIndex: number;
}

export const QUIZ_BANK: QuizQuestion[] = [
  {
    id: 'busan-beach',
    question: {
      ko: '부산에서 가장 큰 해수욕장은 어디일까요?',
      en: 'Which is the largest beach in Busan?',
    },
    choices: [
      { ko: '해운대해수욕장', en: 'Haeundae Beach' },
      { ko: '광안리해수욕장', en: 'Gwangalli Beach' },
      { ko: '송정해수욕장', en: 'Songjeong Beach' },
      { ko: '다대포해수욕장', en: 'Dadaepo Beach' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-bridge',
    question: {
      ko: '광안리 앞바다를 가로지르는 다리의 이름은?',
      en: 'What is the name of the bridge crossing the sea off Gwangalli?',
    },
    choices: [
      { ko: '광안대교', en: 'Gwangan Bridge' },
      { ko: '부산항대교', en: 'Busan Harbor Bridge' },
      { ko: '남항대교', en: 'Namhang Bridge' },
      { ko: '을숙도대교', en: 'Eulsukdo Bridge' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-village',
    question: {
      ko: '알록달록한 계단식 마을로 "한국의 산토리니"라 불리는 곳은?',
      en: 'Which colorful hillside village is called the "Santorini of Korea"?',
    },
    choices: [
      { ko: '감천문화마을', en: 'Gamcheon Culture Village' },
      { ko: '흰여울문화마을', en: 'Huinnyeoul Culture Village' },
      { ko: '초량이바구길', en: 'Choryang Ibagu-gil' },
      { ko: '아미동 비석마을', en: 'Ami-dong Tombstone Village' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-temple',
    question: {
      ko: '바다를 바로 앞에 두고 있어 유명한 부산의 사찰은?',
      en: 'Which Busan temple is famous for sitting right on the seaside?',
    },
    choices: [
      { ko: '해동용궁사', en: 'Haedong Yonggungsa' },
      { ko: '범어사', en: 'Beomeosa' },
      { ko: '삼광사', en: 'Samgwangsa' },
      { ko: '홍법사', en: 'Hongbeopsa' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-market',
    question: {
      ko: '부산을 대표하는 수산물 시장은 어디일까요?',
      en: 'Which is the seafood market that represents Busan?',
    },
    choices: [
      { ko: '자갈치시장', en: 'Jagalchi Market' },
      { ko: '국제시장', en: 'Gukje Market' },
      { ko: '부평깡통시장', en: 'Bupyeong Kkangtong Market' },
      { ko: '구포시장', en: 'Gupo Market' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-film',
    question: {
      ko: '매년 부산에서 열리는 국제 영화제의 주 상영관이 있는 곳은?',
      en: 'Where is the main venue of the international film festival held in Busan?',
    },
    choices: [
      { ko: '영화의전당', en: 'Busan Cinema Center' },
      { ko: '부산시민회관', en: 'Busan Citizens Hall' },
      { ko: '벡스코', en: 'BEXCO' },
      { ko: '부산문화회관', en: 'Busan Cultural Center' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-tower',
    question: {
      ko: '용두산공원에 있는 부산의 상징적인 전망 타워는?',
      en: 'Which landmark observation tower stands in Yongdusan Park?',
    },
    choices: [
      { ko: '부산타워', en: 'Busan Tower' },
      { ko: '황령산 봉수대', en: 'Hwangnyeongsan Beacon Tower' },
      { ko: '오륙도 스카이워크', en: 'Oryukdo Skywalk' },
      { ko: '더베이 101', en: 'The Bay 101' },
    ],
    answerIndex: 0,
  },
  {
    id: 'busan-island',
    question: {
      ko: '부산 앞바다에 있는, 보는 각도에 따라 섬의 수가 달라 보인다는 섬은?',
      en: 'Which islets off Busan appear to change in number depending on the viewing angle?',
    },
    choices: [
      { ko: '오륙도', en: 'Oryukdo' },
      { ko: '영도', en: 'Yeongdo' },
      { ko: '가덕도', en: 'Gadeokdo' },
      { ko: '을숙도', en: 'Eulsukdo' },
    ],
    answerIndex: 0,
  },
];
