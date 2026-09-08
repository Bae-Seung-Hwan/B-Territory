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
 *
 * 제4조(위치정보의 처리)는 위치기반서비스 이용약관 제4조와 **같은 사실을 서술한다.**
 * 좌표의 보유·삭제 방식을 바꾸면 두 문서를 함께 고쳐야 하며, 근거가 되는 구현
 * (Redis GEO 덮어쓰기, handleDisconnect의 geoRemove, GEO_STALE_TTL·GEO_PRUNE_INTERVAL_MS)은
 * location-terms.ts의 주석에 정리해 두었다.
 *
 * 제1조 2호의 미션 사진 항목과 제4조 7호의 EXIF 관련 문구는, missions.service.ts의
 * submitPhoto가 사진 버퍼를 리사이즈·메타데이터 제거 없이 그대로 S3에 업로드하고
 * (image-signature.util.ts의 assertSupportedImage는 매직 바이트로 포맷만 판별할 뿐 메타데이터는
 * 건드리지 않는다) 있다는 사실에 근거한다. 즉 촬영 기기가 사진에 기록한 위치 메타데이터가
 * 있다면 그대로 S3에 남는다 — 제4조 2~3항이 말하는 "서버 메모리의 최신 1건" 좌표(실시간
 * 매칭·결투용)와는 별개의 경로다. 업로드 전 메타데이터 제거를 구현하면 이 문구부터 고칠 것.
 *
 * 제1조 4호·제3조 1~3항의 신고 관련 예외는 report.entity.ts의 실제 컬럼 설계에 근거한다.
 * `targetNickname`은 FK 없는 비정규화 varchar(마이그레이션 주석: "적시 대응"을 위해 일부러
 * FK를 안 걸었다)라 계정을 삭제해도(account.service.ts의 deleteAccount는 User 행만 지운다)
 * 지워지지 않는다. `contentSnapshot`도 같은 테이블의 별도 컬럼으로, moderation.service.ts의
 * report()가 신고 시점 메시지를 그대로 복사해 넣는다. 두 컬럼 다 신고 기록과 함께 계정 삭제 후에도
 * 그대로 남으므로, 제3조 1~2항의 "지체 없이 삭제"·"식별자를 제거한 형태로 남습니다" 서술에서
 * 명시적으로 예외 처리했다. 이 컬럼들을 익명화하는 배치가 생기면 이 문구부터 고칠 것.
 *
 * 제1조 1호의 "약관 동의 이력" 항목은 `backend/src/consents/entities/user-consent.entity.ts`
 * (`user_consents`: document·version·agreedAt, append-only)에 근거한다. 만 14세 확인도 같은
 * 원장에 `age14` 행으로 남고, 그 `version`만 서버가 `AGE_POLICY_VERSION`으로 채운다.
 *
 * 제3조 3항(탈퇴 시 동의 이력 백업)은 `backend/src/account/withdrawal-archive.service.ts`에
 * 구현돼 있다. `deleteAccount`가 `manager.delete(User, ...)` 하는 바로 그 트랜잭션 안에서,
 * 삭제 **직전에** 동의 이력과 이메일 주소를 `withdrawn_accounts`/`consent_archives`로 옮긴다.
 * 6개월 파기는 `withdrawal-archive` 큐의 purge 잡(매일 04:10 KST)이 맡으며, 보관 건을 지우면
 * 동의 행은 FK CASCADE로 함께 사라져 3항의 "그 이후에는 서비스도 동의 사실을 확인할 수
 * 없습니다"가 성립한다. 3항이 금지한 용도(탈퇴자 식별·재가입 제한·광고)로 쓰지 않도록,
 * 이 표를 읽는 경로는 이의제기 대응용 내부 조회 하나뿐이고 HTTP로 열지 않았다.
 * 구현 방식을 바꾸면(기간·항목·보관 위치) 이 조항들부터 고칠 것.
 *
 * 제1조 1호 마지막 줄(Google 계정 로그인)은 `use-google-login.ts`·`login.tsx`의 Google 버튼에
 * 근거한다. Apple은 `login.tsx`에 "임시 비활성화"로 주석 처리돼 있어 의도적으로 넣지 않았다 —
 * 활성화하면 제1조 1호와 제6조 위탁에 함께 추가할 것.
 *
 * 제1조 2호의 "미션 방문 확인 기록"과 제4조 5항은 `missions.service.ts`의
 * `checkin()` → `redis.markVisit()`에 근거한다. `mission:visit:{userId}:{spotId}`에 시군구
 * 코드를 `VISIT_WINDOW_SECONDS`(24시간) TTL로 넣고 제출 시 `getVisit()`으로 다시 읽는다.
 * **좌표와는 다른 수명이라 조항을 따로 두었다** — 제4조 2~3항의 좌표는 접속 종료 시 사라지지만
 * 이 기록은 24시간 남는다. 탈퇴 시 삭제는 `purgeUserKeys`의 `missionVisitKey(userId, '*')`
 * 패턴 삭제가 담당한다. 그 상수나 TTL을 바꾸면 이 조항의 "24시간"도 함께 고칠 것.
 *
 * 제6조는 마크다운 표가 아니라 번호 목록이다. 본문은 `login.tsx`가 `<Text>`에 그대로 넣어
 * 렌더링하므로 마크다운이 해석되지 않는다 — 예전 `| 수탁자 | 위탁 업무 |` 표기는 이용자에게
 * 파이프 문자 그대로 보였다. **본문에 마크다운 문법을 쓰지 말 것.**
 */
export const privacyPolicy: LegalDocument = {
  version: '2026-09-08',
  labelKey: 'privacyPolicy',
  titleKey: 'privacyPolicyTitle',
  body: {
    ko: `B-Territory(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 개인정보 보호법 및 위치정보의 보호 및 이용 등에 관한 법률을 준수합니다.

제1조 (수집하는 개인정보 항목)
1. 회원가입 시 수집하는 항목
   - 이메일 주소, 닉네임, 국적(팀 배정에 사용)
   - Firebase 인증 식별자(UID). 이메일로 가입하는 경우 비밀번호는 서비스가 저장하지 않으며 Google Firebase Authentication이 보관합니다.
   - 약관 동의 이력(동의한 문서 종류·개정일, 만 14세 이상 확인 여부, 동의 일시)
   - Google 계정으로 가입·로그인하는 경우 이메일 주소는 이용자가 직접 입력하지 않고 Google로부터 제공받으며, 이때 서비스는 비밀번호를 만들지 않습니다. 닉네임과 국적은 가입 경로와 관계없이 이용자가 직접 입력합니다.
2. 서비스 이용 과정에서 수집·생성되는 항목
   - 단말기의 GPS 위치정보(앱을 사용하는 동안에만 수집하며, 데이터베이스에 이력으로 남기지 않습니다 — 보관·삭제 방식은 제4조 참고)
   - 관광지 점령 기록(지점 식별자, 팀, 이용자 식별자 — 좌표는 포함하지 않습니다)
   - 관광지 미션 방문 확인 기록(관광지 식별자와 해당 관광지의 시군구 코드 — 좌표는 포함하지 않으며, 보관 기간은 제4조 5항 참고)
   - 결투 기록(상대, 승패, 점수 증감)
   - 미션 사진 및 후기(이용자가 직접 촬영·작성한 내용 — 사진 파일에 촬영 기기가 기록한 위치 정보가
     남아 있을 수 있으며, 서비스는 이를 확인·제거하지 않고 원본 그대로 보관합니다. 자세한 내용은
     제4조 7호 참고)
   - 신고·차단 기록
   - 위치정보 이용·제공사실 확인자료(제4조 참고)
3. 서비스는 백그라운드 위치 추적을 하지 않으며, 푸시 알림 토큰을 수집하지 않습니다.
4. 같은 팀 이용자 간 채팅 메시지는 실시간으로 전달만 하며 서버에 저장하지 않습니다. 다만 메시지가
   신고되면 신고 처리를 위해 신고 시점의 메시지 내용이 신고 기록에 별도로 보관됩니다(보관에
   관하여는 제3조 2항 참고).

제2조 (개인정보의 이용 목적)
1. 회원 식별 및 계정 관리
2. 관광지 방문 인증, 점령 판정, 팀·구역 점수 집계
3. 관광지 미션(사진·후기) 이용을 위한 방문 확인
4. 인근 이용자 탐지 및 결투 매칭
5. 순위(명예의 전당) 산출 및 표시
6. 신고 처리 및 서비스 운영·부정 이용 방지
7. 약관 동의 사실의 증명 및 동의 여부에 관한 분쟁 대응

제3조 (보유 기간 및 파기)
1. 이용자가 계정을 삭제하면 이메일·닉네임·국적·인증 식별자 등 이용자를 직접 식별하는 정보는 서비스 운영 데이터베이스에서 지체 없이 삭제합니다. 다만 이용자가 신고를 당한 이력이 있다면 그 신고 기록에 남은 신고 당시 닉네임은 4항에 따라 계속 보관되며, 약관 동의 이력은 3항에 따라 별도로 보관됩니다.
2. 점수 원장, 점령 기록, 결투 기록, 미션 사진·후기, 신고 기록은 다른 이용자의 기록 및 팀 집계와 결합되어 있어, 이용자 식별자를 제거한 형태로 남습니다. 다만 신고 기록의 신고 당시 닉네임과 메시지 내용은 예외입니다(4항 참고).
3. 계정 삭제 시 약관 동의 이력은 서비스 운영 데이터베이스에서 분리해 별도의 보관소로 옮긴 뒤 6개월간 보관하고 파기합니다.
   - 보관하는 항목: 동의한 문서의 종류와 개정일, 만 14세 이상 확인 여부, 동의 일시, 그리고 그 이력을 해당 이용자의 것으로 특정하기 위한 이메일 주소
   - 보관하는 목적: 개인정보 보호법 및 위치정보의 보호 및 이용 등에 관한 법률이 사업자에게 지우는 "동의를 받았다는 사실"의 증명 책임을 이행하고, 동의 여부에 관한 분쟁에 대응하기 위함입니다. 동의를 받으면서 그 증거를 탈퇴와 동시에 없애면 증명 자체가 불가능해지므로 최소한의 항목만 남깁니다.
   - 이 보관소는 서비스 운영에 사용하지 않습니다. 탈퇴한 이용자를 서비스 안에서 식별하거나, 재가입을 제한하거나, 광고·통계에 이용하지 않습니다.
   - 보관 기간이 지나면 자동으로 파기하며, 그 이후에는 서비스도 동의 사실을 확인할 수 없습니다.
4. 다음 네 가지는 계정 삭제 후에도 남습니다.
   - 위치정보 이용·제공사실 확인자료: 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 6개월간 보존한 뒤 삭제합니다.
   - 미션으로 업로드한 사진 파일: 현재 계정 삭제 시 파일 자체는 삭제되지 않으며, 사진과 이용자를 연결하는 식별자만 제거됩니다.
   - 신고 기록의 신고 당시 닉네임·메시지 내용: 신고 처리의 적시성을 위해 계정과 분리해 별도로 보관하는 값이라, 계정을 삭제해도 신고 기록에서 삭제되지 않습니다.
   - 약관 동의 이력 백업: 3항에 따라 6개월간 보관한 뒤 파기합니다.
5. 법령에 따라 보존 의무가 있는 정보는 해당 기간 동안 보관한 뒤 파기합니다.

제4조 (위치정보의 처리)
1. 서비스는 관광지 방문 인증, 관광지 미션 이용을 위한 방문 확인, 실시간 이용자 매칭을 위해 이용자의 위치정보를 이용합니다.
2. 위치 좌표는 인근 이용자 탐지와 결투 성립 여부를 판정하기 위해 서버 메모리에 이용자별 최신 1건만 보관하며, 이동 경로나 방문 이력으로 누적하지 않습니다. 새 좌표를 받으면 이전 값을 덮어씁니다.
3. 보관한 좌표는 다음과 같이 삭제됩니다.
   - 앱 접속을 종료하면 즉시 삭제합니다.
   - 비정상 종료 등으로 남은 좌표는 마지막 갱신 시점으로부터 최대 15분 이내에 자동으로 삭제됩니다.
   - 계정을 삭제하면 즉시 삭제합니다.
4. 위치 좌표는 데이터베이스에 저장하지 않습니다. 점령 기록에는 관광지 식별자만 남고 좌표는 포함되지 않습니다.
5. 관광지 미션은 이용자가 관광지 인근에서 방문을 확인한 뒤 24시간 안에 제출할 수 있습니다. 이를 위해 방문을 확인한 시점에 관광지 식별자와 해당 관광지의 시군구 코드를 24시간 동안 보관하고, 24시간이 지나면 자동으로 삭제합니다. 이 기록에는 좌표가 포함되지 않습니다. 2항·3항의 좌표와 달리 앱 접속을 종료해도 남으며, 계정을 삭제하면 즉시 삭제합니다.
6. 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 "위치정보를 이용한 사실"의 기록(이용자 식별자, 취득 경로, 제공 서비스 구분, 이용 일시)은 자동으로 남으며 6개월간 보존합니다. 이 기록에는 좌표가 포함되지 않습니다.
7. 이 조 2항부터 5항까지는 실시간 이용자 탐지·결투 판정과 미션 방문 확인에 쓰는 위치정보에 관한 내용입니다. 미션 사진 파일에 촬영 기기가 자체적으로 기록한 위치 정보는 서비스가 추출·이용하지 않으며 별도로 제거하지도 않습니다 — 사진 원본과 함께 그대로 보관되고, 그 보유·삭제는 제1조 2호·제3조를 따릅니다.
8. 위치정보에 관한 상세한 사항은 별도의 위치기반서비스 이용약관에서 정합니다.

제5조 (개인정보의 제3자 제공)
서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따라 수사기관 등이 적법한 절차로 요구하는 경우는 예외로 합니다.

제6조 (처리의 위탁)
서비스는 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.

1. Google (Firebase Authentication)
   위탁 업무: 회원 인증, Google 계정 로그인 처리, 비밀번호 보관, 이메일 인증
2. Amazon Web Services
   위탁 업무: 서버 운영, 미션 사진 파일 보관, 제3조 3항의 약관 동의 이력 백업 보관

지도 화면은 Google Maps SDK를 앱에 내장하여 표시합니다. 서비스는 이용자의 위치 좌표를 Google에 전송하지 않으며, 지도 위의 현재 위치 표시도 SDK 기능이 아니라 앱이 직접 그립니다. 다만 지도를 그리는 과정에서 SDK가 Google과 통신합니다.

제7조 (이용자의 권리)
1. 이용자는 언제든지 자신의 개인정보를 조회하고, 앱 내에서 계정을 삭제할 수 있습니다.
2. 이용자는 단말기의 설정에서 위치 권한을 철회할 수 있습니다. 다만 위치 권한이 없으면 방문 인증, 관광지 미션, 결투 기능을 이용할 수 없습니다.
3. 권리 행사는 B.territory123@gmail.com으로 요청할 수 있습니다.
4. 이용자는 제3조 3항에 따라 보관 중인 자신의 약관 동의 이력에 대해서도 열람과 파기를 요구할 수 있습니다. 다만 파기를 요구하는 경우 서비스는 그 이용자로부터 동의를 받았다는 사실을 더 이상 증명할 수 없게 된다는 점을 함께 안내합니다.

제8조 (만 14세 미만 아동의 개인정보)
서비스는 만 14세 미만 아동의 가입을 받지 않으며, 만 14세 미만임이 확인된 계정의 개인정보는 삭제합니다.

제9조 (안전성 확보 조치)
1. 모든 통신 구간은 암호화된 연결(HTTPS/WSS)로 보호합니다.
2. 이메일로 가입한 계정의 비밀번호는 서비스가 직접 보관하지 않고 Firebase Authentication에 위임합니다. Google 계정으로 가입한 경우에는 서비스가 비밀번호를 만들지도, 보관하지도 않습니다.
3. 개인정보에 접근할 수 있는 권한은 업무상 필요한 최소한으로 제한합니다.
4. 제3조 3항의 동의 이력 백업은 서비스 운영 데이터베이스와 분리해 보관하며, 접근 권한은 동의 사실의 증명이 필요한 경우로 제한합니다.

제10조 (개인정보 보호책임자 및 문의처)
개인정보 처리에 관한 문의·불만·피해구제는 B.territory123@gmail.com으로 접수하며, 접수 즉시 답변드리겠습니다.

부칙
이 방침은 2026년 9월 8일부터 시행합니다. 방침이 변경되는 경우 적용일자와 변경사유를 앱 내에 공지합니다.`,
    en: `B-Territory (the "Service") treats personal data with care and complies with the Personal Information Protection Act and the Act on the Protection and Use of Location Information of the Republic of Korea.

Article 1 (Personal Data Collected)
1. Collected at sign-up
   - Email address, nickname, nationality (used for team assignment)
   - Firebase authentication identifier (UID). For accounts created with an email address, the Service does not store the password; it is held by Google Firebase Authentication.
   - A record of terms agreed to (which documents and revision dates, whether age 14+ was confirmed, and when)
   - Where the user signs up or signs in with a Google account, the email address is received from Google rather than entered by the user, and no password is created by the Service. The nickname and nationality are entered by the user regardless of the sign-up route.
2. Collected or generated while using the Service
   - GPS location from the device (collected only while the app is in use; not recorded as a history in the database - see Article 4 for how coordinates are held and deleted)
   - Site claim records (site identifier, team, user identifier - coordinates are not included)
   - Mission visit confirmations (site identifier and the district code of that site - coordinates are not included; see Article 4(5) for the retention period)
   - Duel records (opponent, outcome, point changes)
   - Mission photos and reviews (content the user takes or writes - a photo file may retain location
     data recorded by the capturing device; the Service does not check for or remove it, keeping the
     file as-is. See Article 4(6))
   - Reports and blocks
   - Records of the fact that location information was used (see Article 4)
3. The Service does not track location in the background and does not collect push notification tokens.
4. Chat messages between users on the same team are relayed in real time and are not stored on the server. If a message is reported, however, its content at the time of the report is kept separately in the report record for handling the report (see Article 3(2)).

Article 2 (Purposes of Use)
1. Identifying members and managing accounts
2. Verifying visits, deciding claims, and tallying team and district points
3. Confirming a visit so that site missions (photos and reviews) can be submitted
4. Detecting nearby users and matching duels
5. Calculating and displaying rankings (Hall of Fame)
6. Handling reports, operating the Service, and preventing abuse
7. Proving that consent was obtained and responding to disputes about consent

Article 3 (Retention and Destruction)
1. When a user deletes their account, data that directly identifies them - email, nickname, nationality, authentication identifier - is deleted from the operational database without delay. If the user has been reported, however, the nickname recorded at the time of that report is retained under paragraph 4, and the record of terms agreed to is retained separately under paragraph 3.
2. The point ledger, claim records, duel records, mission photos and reviews, and reports are combined with other users' records and team tallies, and therefore remain with the user identifier removed - except for the reported-nickname and message-content fields in a report record (see paragraph 4).
3. On account deletion, the record of terms agreed to is moved out of the operational database into a separate archive, kept for six months, and then destroyed.
   - What is kept: the type and revision date of each document agreed to, whether age 14+ was confirmed, the time of agreement, and the email address needed to attribute that record to the user.
   - Why it is kept: to discharge the operator's burden, under the Personal Information Protection Act and the Act on the Protection and Use of Location Information, of proving that consent was obtained, and to respond to disputes about whether it was. Destroying the evidence at the moment of withdrawal would make that proof impossible, so only the minimum is retained.
   - This archive is not used to operate the Service. It is not used to identify a withdrawn user within the Service, to restrict re-registration, or for advertising or statistics.
   - Once the retention period ends the archive is destroyed automatically, after which the Service can no longer confirm that consent was given.
4. The following four remain after account deletion.
   - Records of location information use: retained for six months under Article 16(2) of the Act on the Protection and Use of Location Information, then deleted.
   - Photo files uploaded through missions: the files themselves are currently not deleted on account deletion; only the identifier linking a photo to the user is removed.
   - The nickname and message content recorded at the time of a report: kept separately from the account, for the timely handling of reports, and are not removed from the report record when the account is deleted.
   - The archived record of terms agreed to: kept for six months under paragraph 3 and then destroyed.
5. Information subject to a statutory retention obligation is kept for the required period and then destroyed.

Article 4 (Processing of Location Information)
1. The Service uses location information to verify visits to tourist sites, to confirm a visit so that site missions can be submitted, and to match users in real time.
2. Coordinates are held in server memory as a single most-recent entry per user, in order to detect nearby users and to decide whether a duel may take place. They are not accumulated into a movement trail or a visit history; a new coordinate overwrites the previous one.
3. Stored coordinates are deleted as follows.
   - Immediately when the user disconnects from the app.
   - Within at most 15 minutes of the last update, for coordinates left behind by an abnormal disconnection.
   - Immediately upon account deletion.
4. Coordinates are not stored in the database. Claim records contain only the site identifier, not coordinates.
5. A site mission may be submitted within 24 hours of confirming a visit near the site. To make that possible, the site identifier and that site's district code are kept for 24 hours from the moment the visit is confirmed and are deleted automatically once that period ends. This record contains no coordinates. Unlike the coordinates in paragraphs 2 and 3, it survives disconnection from the app; it is deleted immediately upon account deletion.
6. Under Article 16(2) of the Act on the Protection and Use of Location Information, a record of the fact that location information was used - user identifier, acquisition path, service category, and time of use - is created automatically and retained for six months. This record does not contain coordinates.
7. Paragraphs 2 to 5 of this Article concern the location information used to detect nearby users, to decide duels in real time, and to confirm mission visits. Location data that a capturing device itself records in a mission photo file is not extracted or used by the Service, and is not removed either - it is kept as-is together with the photo, and its retention and deletion follow Article 1(2) and Article 3.
8. Details concerning location information are set out in the separate Location-Based Services Terms.

Article 5 (Provision to Third Parties)
The Service does not provide personal data to third parties, except where lawfully required by investigative or other authorities under applicable law.

Article 6 (Entrusted Processing)
The Service entrusts the processing of personal data as follows.

1. Google (Firebase Authentication)
   Entrusted work: member authentication, Google account sign-in, password storage, email verification
2. Amazon Web Services
   Entrusted work: server operation, storage of mission photo files, and storage of the archived consent records under Article 3(3)

The map view is rendered with the Google Maps SDK embedded in the app. The Service does not transmit the user's coordinates to Google, and the current-location marker is drawn by the app itself rather than by the SDK. The SDK does, however, communicate with Google in order to render the map.

Article 7 (User Rights)
1. Users may review their personal data at any time and delete their account from within the app.
2. Users may withdraw location permission in their device settings. Without location permission, visit verification, site missions, and duel features cannot be used.
3. Requests may be sent to B.territory123@gmail.com.
4. Users may also request access to, or destruction of, their archived consent record held under Article 3(3). Where destruction is requested, the Service will explain that it will no longer be able to prove that consent was obtained from that user.

Article 8 (Children Under 14)
The Service does not accept sign-ups from children under the age of 14 and deletes the personal data of any account confirmed to belong to a child under 14.

Article 9 (Security Measures)
1. All communication is protected by encrypted connections (HTTPS/WSS).
2. For accounts created with an email address, passwords are not held by the Service; they are delegated to Firebase Authentication. For accounts created with a Google account, the Service neither creates nor holds a password.
3. Access to personal data is limited to the minimum necessary for operations.
4. The archived consent records under Article 3(3) are held separately from the operational database, and access is limited to cases where proof of consent is required.

Article 10 (Contact)
Enquiries, complaints, and remedy requests concerning the processing of personal data are received at B.territory123@gmail.com and will be answered promptly.

Addendum
This Policy takes effect on 8 September 2026. Any change will be announced in the app with the effective date and the reason for the change.`,
  },
};
