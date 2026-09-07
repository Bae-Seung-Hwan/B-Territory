import type { LegalDocument } from './types';

/**
 * 개인정보처리방침.
 *
 * ⚠️ **법률 검토 전 초안이다** (docs/compliance.md 6장 미결 항목).
 *
 * 조항은 docs/compliance.md 1장(실제 수집 항목)과 5장(탈퇴 시 처리)을 근거로 썼다. 특히
 * 5장이 "개인정보처리방침에 반드시 명시할 것"으로 못박은 두 가지 — 위치정보 이용·제공사실
 * 확인자료가 탈퇴 후에도 6개월 남는 것, 미션 사진 원본(S3)이 탈퇴 시 삭제되지 않는 것 —
 * 은 제3조에 그대로 반영돼 있다. **실제 동작을 바꾸면 그 조항부터 고칠 것.**
 *
 * 미구현 기능(백그라운드 위치 추적, 푸시 알림 토큰)은 의도적으로 넣지 않았다 —
 * compliance.md 1장의 "구현되는 시점에 갱신한다" 규칙을 따른다.
 */
export const privacyPolicy: LegalDocument = {
  version: '2026-09-07',
  labelKey: 'privacyPolicy',
  titleKey: 'privacyPolicyTitle',
  body: {
    ko: `B-Territory(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 개인정보 보호법 및 위치정보의 보호 및 이용 등에 관한 법률을 준수합니다.

제1조 (수집하는 개인정보 항목)
1. 회원가입 시 수집하는 항목
   - 이메일 주소, 닉네임, 국적(팀 배정에 사용)
   - Firebase 인증 식별자(UID). 비밀번호는 서비스가 저장하지 않으며 Google Firebase Authentication이 보관합니다.
2. 서비스 이용 과정에서 수집·생성되는 항목
   - 단말기의 GPS 위치정보(앱을 사용하는 동안에만 수집하며, 좌표 자체는 저장하지 않습니다)
   - 관광지 점령 기록(지점 식별자, 팀, 이용자 식별자 — 좌표는 포함하지 않습니다)
   - 결투 기록(상대, 승패, 점수 증감)
   - 미션 사진 및 후기(이용자가 직접 촬영·작성한 내용)
   - 신고·차단 기록
   - 위치정보 이용·제공사실 확인자료(제4조 참고)
3. 서비스는 백그라운드 위치 추적을 하지 않으며, 푸시 알림 토큰을 수집하지 않습니다.
4. 같은 팀 이용자 간 채팅 메시지는 실시간으로 전달만 하며 서버에 저장하지 않습니다.

제2조 (개인정보의 이용 목적)
1. 회원 식별 및 계정 관리
2. 관광지 방문 인증, 점령 판정, 팀·구역 점수 집계
3. 인근 이용자 탐지 및 결투 매칭
4. 순위(명예의 전당) 산출 및 표시
5. 신고 처리 및 서비스 운영·부정 이용 방지

제3조 (보유 기간 및 파기)
1. 이용자가 계정을 삭제하면 이메일·닉네임·국적·인증 식별자 등 이용자를 직접 식별하는 정보는 지체 없이 삭제합니다.
2. 점수 원장, 점령 기록, 결투 기록, 미션 사진·후기, 신고 기록은 다른 이용자의 기록 및 팀 집계와 결합되어 있어, 이용자 식별자를 제거한 형태로 남습니다.
3. 다음 두 가지는 계정 삭제 후에도 남습니다.
   - 위치정보 이용·제공사실 확인자료: 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 6개월간 보존한 뒤 삭제합니다.
   - 미션으로 업로드한 사진 파일: 현재 계정 삭제 시 파일 자체는 삭제되지 않으며, 사진과 이용자를 연결하는 식별자만 제거됩니다.
4. 법령에 따라 보존 의무가 있는 정보는 해당 기간 동안 보관한 뒤 파기합니다.

제4조 (위치정보의 처리)
1. 서비스는 방문 인증과 실시간 이용자 매칭을 위해 이용자의 위치정보를 이용합니다.
2. 위치 좌표는 처리 목적을 달성한 즉시 사용되고 저장되지 않습니다. 다만 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 "위치정보를 이용한 사실"의 기록(이용자 식별자, 취득 경로, 제공 서비스 구분, 이용 일시)은 자동으로 남으며 6개월간 보존합니다. 이 기록에는 좌표가 포함되지 않습니다.
3. 위치정보에 관한 상세한 사항은 별도의 위치기반서비스 이용약관에서 정합니다.

제5조 (개인정보의 제3자 제공)
서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따라 수사기관 등이 적법한 절차로 요구하는 경우는 예외로 합니다.

제6조 (처리의 위탁)
서비스는 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.

| 수탁자 | 위탁 업무 |
| Google (Firebase Authentication) | 회원 인증, 비밀번호 보관, 이메일 인증 |
| Amazon Web Services | 서버 운영 및 미션 사진 파일 보관 |

카카오맵은 지도 화면 표시에 사용되며, 서비스는 이용자의 위치를 카카오에 전달하지 않습니다.

제7조 (이용자의 권리)
1. 이용자는 언제든지 자신의 개인정보를 조회하고, 앱 내에서 계정을 삭제할 수 있습니다.
2. 이용자는 단말기의 설정에서 위치 권한을 철회할 수 있습니다. 다만 위치 권한이 없으면 방문 인증과 결투 기능을 이용할 수 없습니다.
3. 권리 행사는 B.territory123@gmail.com으로 요청할 수 있습니다.

제8조 (만 14세 미만 아동의 개인정보)
서비스는 만 14세 미만 아동의 가입을 받지 않으며, 만 14세 미만임이 확인된 계정의 개인정보는 삭제합니다.

제9조 (안전성 확보 조치)
1. 모든 통신 구간은 암호화된 연결(HTTPS/WSS)로 보호합니다.
2. 비밀번호는 서비스가 직접 보관하지 않고 Firebase Authentication에 위임합니다.
3. 개인정보에 접근할 수 있는 권한은 업무상 필요한 최소한으로 제한합니다.

제10조 (개인정보 보호책임자 및 문의처)
개인정보 처리에 관한 문의·불만·피해구제는 B.territory123@gmail.com으로 접수하며, 접수 즉시 답변드리겠습니다.

부칙
이 방침은 2026년 9월 7일부터 시행합니다. 방침이 변경되는 경우 적용일자와 변경사유를 앱 내에 공지합니다.`,
    en: `B-Territory (the "Service") treats personal data with care and complies with the Personal Information Protection Act and the Act on the Protection and Use of Location Information of the Republic of Korea.

Article 1 (Personal Data Collected)
1. Collected at sign-up
   - Email address, nickname, nationality (used for team assignment)
   - Firebase authentication identifier (UID). The Service does not store passwords; they are held by Google Firebase Authentication.
2. Collected or generated while using the Service
   - GPS location from the device (collected only while the app is in use; coordinates themselves are not stored)
   - Site claim records (site identifier, team, user identifier - coordinates are not included)
   - Duel records (opponent, outcome, point changes)
   - Mission photos and reviews (content the user takes or writes)
   - Reports and blocks
   - Records of the fact that location information was used (see Article 4)
3. The Service does not track location in the background and does not collect push notification tokens.
4. Chat messages between users on the same team are relayed in real time and are not stored on the server.

Article 2 (Purposes of Use)
1. Identifying members and managing accounts
2. Verifying visits, deciding claims, and tallying team and district points
3. Detecting nearby users and matching duels
4. Calculating and displaying rankings (Hall of Fame)
5. Handling reports, operating the Service, and preventing abuse

Article 3 (Retention and Destruction)
1. When a user deletes their account, data that directly identifies them - email, nickname, nationality, authentication identifier - is deleted without delay.
2. The point ledger, claim records, duel records, mission photos and reviews, and reports are combined with other users' records and team tallies, and therefore remain with the user identifier removed.
3. The following two remain after account deletion.
   - Records of location information use: retained for six months under Article 16(2) of the Act on the Protection and Use of Location Information, then deleted.
   - Photo files uploaded through missions: the files themselves are currently not deleted on account deletion; only the identifier linking a photo to the user is removed.
4. Information subject to a statutory retention obligation is kept for the required period and then destroyed.

Article 4 (Processing of Location Information)
1. The Service uses location information to verify visits and to match users in real time.
2. Coordinates are used for their purpose and not stored. However, under Article 16(2) of the Act on the Protection and Use of Location Information, a record of the fact that location information was used - user identifier, acquisition path, service category, and time of use - is created automatically and retained for six months. This record does not contain coordinates.
3. Details concerning location information are set out in the separate Location-Based Services Terms.

Article 5 (Provision to Third Parties)
The Service does not provide personal data to third parties, except where lawfully required by investigative or other authorities under applicable law.

Article 6 (Entrusted Processing)
The Service entrusts the processing of personal data as follows.

| Processor | Entrusted work |
| Google (Firebase Authentication) | Member authentication, password storage, email verification |
| Amazon Web Services | Server operation and storage of mission photo files |

Kakao Map is used to render the map view; the Service does not transmit the user's location to Kakao.

Article 7 (User Rights)
1. Users may review their personal data at any time and delete their account from within the app.
2. Users may withdraw location permission in their device settings. Without location permission, visit verification and duel features cannot be used.
3. Requests may be sent to B.territory123@gmail.com.

Article 8 (Children Under 14)
The Service does not accept sign-ups from children under the age of 14 and deletes the personal data of any account confirmed to belong to a child under 14.

Article 9 (Security Measures)
1. All communication is protected by encrypted connections (HTTPS/WSS).
2. Passwords are not held by the Service; they are delegated to Firebase Authentication.
3. Access to personal data is limited to the minimum necessary for operations.

Article 10 (Contact)
Enquiries, complaints, and remedy requests concerning the processing of personal data are received at B.territory123@gmail.com and will be answered promptly.

Addendum
This Policy takes effect on 7 September 2026. Any change will be announced in the app with the effective date and the reason for the change.`,
  },
};
