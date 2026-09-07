import type { LegalDocument } from './types';

/**
 * 이용약관.
 *
 * ⚠️ **법률 검토 전 초안이다** (docs/compliance.md 6장 미결 항목). 코드가 실제로 하는 일을
 * 근거로 작성했으므로 예전의 예시 텍스트와 달리 내용은 사실과 맞지만, 변호사 검토를 거쳐야
 * 최종본이 된다. 서비스 기능이 바뀌면 제6조와 version을 함께 갱신할 것.
 *
 * 제11조 3항의 신고 기록 예외는 privacy-policy.ts 제3조의 표현과 맞추기 위해 추가했다 —
 * report.entity.ts의 targetNickname·contentSnapshot이 FK 없이 별도 보관된다는 같은 사실을
 * 두 문서가 서로 다른 수위로 서술하면 안 되므로, 한쪽을 고치면 다른 쪽도 함께 볼 것.
 */
export const termsOfService: LegalDocument = {
  version: '2026-09-08',
  labelKey: 'serviceTerms',
  titleKey: 'serviceTermsTitle',
  body: {
    ko: `제1조 (목적)
이 약관은 B-Territory(이하 "서비스")를 이용함에 있어 서비스와 이용자 사이의 권리·의무 및 책임사항을 정하는 것을 목적으로 합니다.

제2조 (정의)
1. "서비스"란 이용자의 위치를 기반으로 관광지를 방문·인증하고, 국적별 팀으로 나뉘어 점수를 겨루는 모바일 애플리케이션을 말합니다.
2. "팀"이란 이용자가 가입 시 선택한 국적에 따라 자동으로 배정되는 집단을 말합니다.
3. "점령"이란 이용자가 관광지 인근에서 방문을 인증하여 해당 지점을 자신의 팀 소유로 표시하는 행위를 말합니다.
4. "결투"란 인근의 다른 팀 이용자와 미니게임으로 승부를 겨루는 기능을 말합니다.

제3조 (약관의 효력 및 변경)
1. 이 약관은 가입 시 동의한 이용자에게 효력이 발생합니다.
2. 서비스는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 적용일자와 변경사유를 명시하여 앱 내에 공지합니다.
3. 이용자에게 불리한 변경의 경우 적용일자로부터 30일 전에 공지하며, 이용자가 변경에 동의하지 않을 경우 계정을 삭제하고 이용을 중단할 수 있습니다.

제4조 (이용계약의 성립)
1. 이용계약은 이용자가 이 약관과 개인정보처리방침, 위치기반서비스 이용약관에 동의하고 서비스가 이를 승낙함으로써 성립합니다.
2. 서비스는 만 14세 이상만 가입할 수 있습니다. 만 14세 미만임이 확인된 계정은 삭제될 수 있습니다.
3. 가입에는 이메일 인증이 필요하며, 인증을 마치지 않은 경우 이용계약이 성립하지 않습니다.

제5조 (계정과 닉네임)
1. 이용자는 자신의 계정을 제3자에게 양도하거나 대여할 수 없습니다.
2. 타인을 사칭하거나 타인에게 불쾌감을 주는 닉네임은 사전 통지 없이 변경 또는 회수될 수 있습니다.
3. 이용자는 자신의 로그인 정보를 관리할 책임이 있으며, 관리 소홀로 발생한 손해에 대해 서비스는 책임지지 않습니다.

제6조 (서비스의 내용)
서비스는 다음 기능을 제공합니다.
1. 관광지 방문 인증 및 점령, 팀·구역 단위 점수 집계
2. 인근 다른 팀 이용자와의 결투(미니게임 승부)
3. 관광지 미션 — 사진 촬영 및 후기 작성
4. 같은 팀 이용자 간 실시간 채팅
5. 개인·팀 순위(명예의 전당) 제공

제7조 (이용자의 의무)
이용자는 다음 행위를 하여서는 안 됩니다.
1. 위치 정보를 조작하는 애플리케이션·기기를 사용하는 등 실제 방문 없이 점령·결투 결과를 얻는 행위
2. 자동화된 수단으로 서비스에 접속하거나 비정상적인 요청을 반복하여 서비스 운영을 방해하는 행위
3. 타인의 계정을 무단으로 이용하거나 타인을 사칭하는 행위
4. 사진·후기·채팅에 타인의 권리를 침해하거나 불쾌감을 주는 내용을 게시하는 행위
5. 그 밖에 관련 법령 또는 이 약관을 위반하는 행위

제8조 (게시물의 관리)
1. 이용자가 등록한 사진·후기·채팅 메시지(이하 "게시물")에 대한 책임은 작성자에게 있습니다.
2. 서비스는 신고 및 차단 기능을 제공하며, 신고된 게시물이 제7조를 위반한 경우 삭제하거나 노출을 제한할 수 있습니다.
3. 이용자는 다른 이용자를 차단할 수 있으며, 차단한 이용자의 메시지는 서버 단계에서 전달되지 않습니다.
4. 신고·문의는 B.territory123@gmail.com으로 접수합니다.

제9조 (게임 내 제재와 이용 제한의 구별)
1. 결투 거절·무응답에 따른 점수 차감, 일정 시간 동안의 결투 제한 등은 게임 규칙에 따른 조정이며 제7조 위반에 대한 제재가 아닙니다.
2. 제7조를 위반한 경우 서비스는 경고, 게시물 삭제, 기능 이용 제한, 이용계약 해지의 조치를 취할 수 있습니다.

제10조 (서비스의 중단 및 변경)
1. 서비스는 설비 점검·교체, 통신 장애, 천재지변 등의 사유로 서비스 제공을 일시 중단할 수 있습니다.
2. 서비스는 운영상·기술상 필요에 따라 제공하는 기능의 전부 또는 일부를 변경할 수 있으며, 중요한 변경은 앱 내에 공지합니다.

제11조 (계정 삭제)
1. 이용자는 언제든지 앱 내에서 계정을 삭제할 수 있습니다.
2. 계정 삭제 시 개인정보는 개인정보처리방침이 정한 바에 따라 처리되며, 법령상 보존 의무가 있는 기록은 해당 기간 동안 보존됩니다.
3. 점수 원장·결투 기록 등 다른 이용자의 기록과 결합된 자료는 이용자를 식별할 수 없는 형태로 남습니다(신고 기록의 신고 당시 닉네임·메시지 내용 등 예외는 개인정보처리방침 제3조를 따릅니다).

제12조 (책임의 제한)
1. 서비스는 이용자가 서비스를 이용하며 이동하는 과정에서 발생한 사고에 대하여 책임지지 않습니다. 이용자는 도로·교통 상황 등 주변 환경에 유의하여야 합니다.
2. 서비스는 GPS 신호 품질, 단말기 성능, 통신 환경에 따라 위치 측정에 오차가 발생할 수 있으며, 이로 인한 인증 실패에 대해 책임지지 않습니다.
3. 서비스는 이용자 간에 발생한 분쟁에 개입할 의무가 없으며, 그로 인한 손해에 대해 책임지지 않습니다.

제13조 (준거법 및 분쟁 해결)
이 약관은 대한민국 법을 준거법으로 하며, 서비스와 이용자 간 분쟁은 관련 법령이 정한 절차에 따릅니다.

부칙
이 약관은 2026년 9월 7일부터 시행합니다.`,
    en: `Article 1 (Purpose)
These Terms set out the rights, obligations, and responsibilities between B-Territory (the "Service") and its users.

Article 2 (Definitions)
1. "Service" means the mobile application in which users verify visits to tourist sites based on their location and compete for points in teams assigned by nationality.
2. "Team" means the group a user is automatically assigned to based on the nationality selected at sign-up.
3. "Claim" means verifying a visit near a tourist site so that the site is marked as held by the user's team.
4. "Duel" means the feature in which a user competes against a nearby user of another team through a mini-game.

Article 3 (Effect and Amendment of Terms)
1. These Terms take effect for users who agree to them at sign-up.
2. The Service may amend these Terms within the limits of applicable law. Amendments are announced in the app with the effective date and the reason for the change.
3. Amendments unfavourable to users are announced at least 30 days before the effective date. A user who does not accept an amendment may delete their account and stop using the Service.

Article 4 (Formation of the Agreement)
1. The agreement is formed when the user agrees to these Terms, the Privacy Policy, and the Location-Based Services Terms, and the Service accepts the application.
2. Only users aged 14 or older may sign up. An account confirmed to belong to a user under 14 may be deleted.
3. Email verification is required; the agreement is not formed until verification is complete.

Article 5 (Account and Nickname)
1. A user may not transfer or lend their account to a third party.
2. A nickname that impersonates another person or is offensive may be changed or reclaimed without prior notice.
3. Users are responsible for safeguarding their login credentials. The Service is not liable for damage resulting from a failure to do so.

Article 6 (Scope of the Service)
The Service provides the following features.
1. Visit verification and claiming of tourist sites, and point tallies by team and district
2. Duels (mini-game contests) with nearby users of other teams
3. Site missions - taking photos and writing reviews
4. Real-time chat among users on the same team
5. Individual and team rankings (Hall of Fame)

Article 7 (User Obligations)
Users must not:
1. Obtain claim or duel outcomes without an actual visit, including by using applications or devices that falsify location;
2. Access the Service by automated means or repeat abnormal requests in a way that interferes with its operation;
3. Use another person's account without authorisation or impersonate another person;
4. Post content in photos, reviews, or chat that infringes the rights of others or is offensive; or
5. Otherwise violate applicable law or these Terms.

Article 8 (Management of User Content)
1. The author is responsible for photos, reviews, and chat messages they submit ("User Content").
2. The Service provides reporting and blocking features and may delete or restrict the visibility of reported content that violates Article 7.
3. A user may block another user; messages from a blocked user are withheld at the server rather than merely hidden on the device.
4. Reports and enquiries are received at B.territory123@gmail.com.

Article 9 (In-Game Adjustments vs. Enforcement)
1. Point deductions for declining or not answering a duel, and temporary restrictions on duelling, are adjustments under the game rules and are not sanctions for a violation of Article 7.
2. Where Article 7 is violated, the Service may issue a warning, delete content, restrict access to features, or terminate the agreement.

Article 10 (Suspension and Modification of the Service)
1. The Service may be suspended temporarily for maintenance or replacement of equipment, communication failures, or force majeure.
2. The Service may change all or part of the features it provides for operational or technical reasons; material changes are announced in the app.

Article 11 (Account Deletion)
1. A user may delete their account at any time from within the app.
2. Personal data is handled on deletion as set out in the Privacy Policy; records subject to a statutory retention obligation are kept for the required period.
3. Records combined with those of other users, such as the point ledger and duel history, remain in a form that does not identify the user (exceptions such as the reported-nickname and message-content fields of a report record are governed by Article 3 of the Privacy Policy).

Article 12 (Limitation of Liability)
1. The Service is not liable for accidents occurring while a user travels in the course of using it. Users must remain aware of roads, traffic, and their surroundings.
2. Location measurement may be inaccurate depending on GPS signal quality, device performance, and network conditions; the Service is not liable for verification failures caused by such inaccuracy.
3. The Service is under no obligation to intervene in disputes between users and is not liable for damage arising from them.

Article 13 (Governing Law and Disputes)
These Terms are governed by the laws of the Republic of Korea, and disputes between the Service and a user follow the procedures prescribed by applicable law.

Addendum
These Terms take effect on 7 September 2026.`,
  },
};
