import type { LegalDocument } from './types';

/**
 * 위치기반서비스 이용약관.
 *
 * ⚠️ **법률 검토 전 초안이다** (docs/compliance.md 6장 미결 항목).
 *
 * 개인정보처리방침으로 갈음할 수 없는 별개의 문서다 — 위치정보의 보호 및 이용 등에 관한
 * 법률상 위치 데이터를 서비스에 이용하면 전용 약관을 따로 두어야 한다(compliance.md 2.3).
 * 예전에는 이 문서 자체가 없어 동의 항목도 두 개뿐이었다.
 *
 * 제3조 1·2호(SVC-01/SVC-02)와 제5조의 보존 항목은 backend/src/location-logs/가 실제로
 * 남기는 값과 1:1로 맞춘 것이다(compliance.md 4장의 신고서 양식 표). **한쪽을 바꾸면 다른
 * 쪽도 함께 고칠 것.**
 *
 * 제3조 3호는 여기 속하지 않는다 — missions.service.ts의 checkin()도 좌표(lat/lng)를 받아
 * verifySpotProximity로 이용하지만, locationLogs.record()를 호출하지 않아 SVC 코드도 없고
 * 제5조의 자동 기록도 남기지 않는다(PR #55 2차 리뷰에서 지적됨). checkin()에 로그를 추가하는
 * 것은 신고서(사업계획서) 양식 갱신이 딸린 별도 결정이라 이번엔 문구만 사실대로 고쳤다 —
 * 실제로 기록을 남기게 되면 3호를 1·2호와 합치고 이 주석·제5조 1항의 범위 제한을 지울 것.
 *
 * 제4조(좌표의 보유·삭제)도 마찬가지로 구현에 묶여 있다. 근거는 다음 세 가지다.
 *   - Redis GEO(`geo:users`)는 member가 userId라 갱신 시 이전 좌표를 덮어쓴다 → "최신 1건"
 *   - realtime.gateway.ts의 handleDisconnect가 geoRemove를 호출한다 → "접속 종료 시 즉시"
 *   - 유령 좌표는 GEO_STALE_TTL(10분) 기준으로 GEO_PRUNE_INTERVAL_MS(5분)마다 도는 잡이
 *     지운다 → 최악 15분. **이 두 상수를 바꾸면 조항의 "15분"도 함께 고칠 것.**
 *
 * 한때 이 조항은 "즉시 이용한 후 저장하지 않습니다"였는데, 실제로는 좌표가 Redis에 남고
 * 결투 신청·아군 보너스 판정에서 다시 읽히고 있었다(나중에 읽는다는 것 자체가 보관의
 * 증거다). 문서가 거짓을 말하던 상태라 구현에 맞춰 고쳤다.
 *
 * 제4조 6호: missions.service.ts의 submitPhoto는 사진 버퍼를 메타데이터 제거 없이 그대로
 * S3에 업로드한다(image-signature.util.ts는 매직 바이트로 포맷만 판별). 이 약관이 다루는
 * "개인위치정보"는 제3조 목적(방문 인증·실시간 매칭)에 쓰는, 서버 메모리의 좌표에 한정된다는
 * 점을 6호로 못박아, 사진 파일에 남을 수 있는 위치 메타데이터까지 이 약관의 보유·삭제 규칙
 * (최신 1건·15분 이내 삭제 등)이 적용되는 것으로 오독되지 않게 한다. 그 파일의 처리는
 * 개인정보처리방침 제1조 2호·제4조 6호·제3조가 정한다.
 */
export const locationTerms: LegalDocument = {
  version: '2026-09-08',
  labelKey: 'locationTerms',
  titleKey: 'locationTermsTitle',
  body: {
    ko: `제1조 (목적)
이 약관은 B-Territory(이하 "서비스")가 제공하는 위치기반서비스에 대하여 서비스와 개인위치정보주체 간의 권리·의무 및 책임사항을 정하는 것을 목적으로 합니다.

제2조 (약관의 효력 및 변경)
1. 이 약관은 가입 시 동의한 이용자에게 효력이 발생합니다.
2. 약관을 변경하는 경우 적용일자와 변경사유를 명시하여 적용일자 15일 전부터 앱 내에 공지합니다.

제3조 (위치기반서비스의 내용)
서비스는 이용자의 개인위치정보를 이용하여 다음 서비스를 제공합니다.
1. 관광지 방문 인증(점령) — 이용자가 관광지 인근에 있는지 확인하여 방문을 인증하고 팀 점수에 반영합니다.
2. 실시간 이용자 매칭(결투) — 인근에 있는 다른 팀 이용자를 탐지하여 결투를 신청할 수 있게 합니다.
3. 관광지 미션(사진·후기) 이용을 위한 사전 방문 확인 — 1호와 별개로, 미션 제출을 열기 위해 관광지 인근 여부만 확인하며 팀 점수에는 반영하지 않습니다. 이 확인은 현재 제5조의 자동 기록 대상에 포함되어 있지 않습니다.

제4조 (개인위치정보의 이용 및 보유)
1. 서비스는 앱이 실행 중일 때에만 개인위치정보를 수집하며, 백그라운드에서는 수집하지 않습니다.
2. 수집한 위치 좌표는 제3조의 목적에 이용하기 위해 서버 메모리에 이용자별 최신 1건만 보관하며, 이동 경로나 방문 이력으로 누적하지 않습니다. 새 좌표를 받으면 이전 값을 덮어씁니다.
3. 보관한 좌표는 앱 접속을 종료하면 즉시 삭제하고, 비정상 종료 등으로 남은 좌표는 마지막 갱신 시점으로부터 최대 15분 이내에 자동으로 삭제합니다. 계정을 삭제하는 경우에도 즉시 삭제합니다.
4. 위치 좌표는 데이터베이스에 저장하지 않습니다.
5. 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 개인위치정보의 이용·제공사실 확인자료를 자동으로 기록하며, 그 내용은 제5조와 같습니다.
6. 이 조가 다루는 개인위치정보는 제3조의 목적에 이용하기 위해 수집한 좌표에 한하며, 미션 사진 파일에 촬영 기기가 자체적으로 기록한 위치 정보는 포함하지 않습니다. 그러한 정보가 사진 파일에 남아 있더라도 서비스는 이를 추출·이용하지 않으며, 그 파일의 보유·삭제는 개인정보처리방침이 따로 정합니다.

제5조 (이용·제공사실 확인자료의 보유 근거와 기간)
1. 서비스는 제3조 1호·2호의 목적으로 개인위치정보를 이용한 때마다 다음 항목을 자동으로 기록합니다.
   - 대상: 이용자 식별자
   - 취득 경로: 이용자 단말의 GPS/네트워크 측위(외부 위치정보사업자를 경유하지 않습니다)
   - 제공 서비스 구분: 관광지 방문 인증 또는 실시간 이용자 매칭
   - 이용 일시
2. 이 기록에는 위치 좌표가 포함되지 않습니다.
3. 위 자료는 6개월간 보존한 뒤 삭제하며, 계정을 삭제하더라도 보존기간이 끝날 때까지 유지됩니다.

제6조 (개인위치정보의 제3자 제공)
서비스는 개인위치정보를 제3자에게 제공하지 않습니다. 지도 화면 표시에 사용하는 Google Maps SDK에도 이용자의 위치를 전달하지 않으며, 지도 위의 현재 위치 표시는 앱이 직접 그립니다.

제7조 (개인위치정보주체의 권리)
1. 이용자는 개인위치정보 이용에 대한 동의를 언제든지 철회할 수 있으며, 단말기의 위치 권한을 해제하거나 계정을 삭제하는 방법으로 철회할 수 있습니다.
2. 이용자는 개인위치정보 이용·제공사실 확인자료의 열람 또는 고지를 요구할 수 있으며, 오류가 있는 경우 정정을 요구할 수 있습니다.
3. 서비스는 위 요구를 받은 경우 지체 없이 필요한 조치를 취합니다.
4. 위치 권한을 해제하면 제3조의 서비스는 이용할 수 없으나, 그 밖의 기능은 계속 이용할 수 있습니다.

제8조 (만 14세 미만 아동)
서비스는 만 14세 미만 아동의 가입을 받지 않으므로 법정대리인의 동의를 받아 개인위치정보를 처리하지 않습니다.

제9조 (손해배상 및 분쟁조정)
1. 서비스가 위치정보의 보호 및 이용 등에 관한 법률을 위반하여 이용자에게 손해를 입힌 경우 이용자는 손해배상을 청구할 수 있습니다.
2. 위치정보와 관련한 분쟁은 관련 법령이 정한 절차에 따라 조정을 신청할 수 있습니다.

제10조 (위치정보관리책임자 및 문의처)
위치정보 처리에 관한 문의는 B.territory123@gmail.com으로 접수합니다.

부칙
이 약관은 2026년 9월 8일부터 시행합니다.`,
    en: `Article 1 (Purpose)
These Terms set out the rights, obligations, and responsibilities between B-Territory (the "Service") and the subject of personal location information in relation to the location-based services the Service provides.

Article 2 (Effect and Amendment)
1. These Terms take effect for users who agree to them at sign-up.
2. Any amendment is announced in the app from 15 days before the effective date, stating the effective date and the reason for the change.

Article 3 (Scope of Location-Based Services)
The Service uses personal location information to provide the following.
1. Visit verification (claiming) - confirming that the user is near a tourist site in order to verify the visit and apply it to the team score.
2. Real-time user matching (duels) - detecting nearby users of other teams so that a duel can be requested.
3. A preliminary visit check for site missions (photos and reviews) - separate from item 1, this only confirms proximity to the site in order to open mission submission, and is not applied to the team score. This check is not currently included among the records automatically kept under Article 5.

Article 4 (Use and Retention of Personal Location Information)
1. The Service collects personal location information only while the app is running; it does not collect it in the background.
2. Collected coordinates are held in server memory as a single most-recent entry per user for the purposes in Article 3, and are not accumulated into a movement trail or a visit history; a new coordinate overwrites the previous one.
3. Stored coordinates are deleted immediately when the user disconnects from the app. Coordinates left behind by an abnormal disconnection are deleted automatically within at most 15 minutes of the last update. They are also deleted immediately upon account deletion.
4. Coordinates are not stored in the database.
5. Under Article 16(2) of the Act on the Protection and Use of Location Information, a record of the use and provision of personal location information is created automatically, as set out in Article 5.
6. The personal location information covered by this Article is limited to coordinates collected for the purposes in Article 3; it does not include location data that a capturing device itself records in a mission photo file. Even if such data remains in a photo file, the Service does not extract or use it, and the retention and deletion of that file are governed separately by the Privacy Policy.

Article 5 (Basis and Period for Retaining Use Records)
1. Each time personal location information is used for the purposes in Article 3(1) or (2), the Service automatically records:
   - Subject: the user identifier
   - Acquisition path: GPS/network positioning on the user's device (no external location information provider is involved)
   - Service category: visit verification or real-time user matching
   - Time of use
2. These records do not contain coordinates.
3. The records are retained for six months and then deleted; they are kept until the end of that period even if the account is deleted.

Article 6 (Provision to Third Parties)
The Service does not provide personal location information to third parties. The user's location is not transmitted to the Google Maps SDK used to render the map view either; the current-location marker on the map is drawn by the app itself.

Article 7 (Rights of the Subject of Personal Location Information)
1. A user may withdraw consent to the use of personal location information at any time, by revoking location permission on the device or by deleting their account.
2. A user may request access to, or notification of, the records of use and provision of personal location information, and may request correction of any error.
3. The Service takes the necessary measures without delay upon receiving such a request.
4. Revoking location permission makes the services in Article 3 unavailable; other features remain usable.

Article 8 (Children Under 14)
The Service does not accept sign-ups from children under the age of 14 and therefore does not process personal location information on the basis of a legal representative's consent.

Article 9 (Damages and Dispute Resolution)
1. Where the Service causes damage to a user by violating the Act on the Protection and Use of Location Information, the user may claim damages.
2. Disputes concerning location information may be submitted for mediation under the procedures prescribed by applicable law.

Article 10 (Location Information Manager and Contact)
Enquiries concerning the processing of location information are received at B.territory123@gmail.com.

Addendum
These Terms take effect on 8 September 2026.`,
  },
};
