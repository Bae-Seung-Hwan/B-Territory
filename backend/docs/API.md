# B-Territory 백엔드 API 문서 (프론트엔드 협업용)

- 기준 브랜치: `develop` + `feature/Bae/auth-me`(PR #14, 리뷰 중)
- Base URL: `http://localhost:3000/api` (모든 엔드포인트에 `/api` 프리픽스 붙음)
- 인터랙티브 문서: 서버 실행 후 `http://localhost:3000/api/docs` (Swagger UI) — 여기서 직접 호출도 가능
- 아래 요청/응답 예시는 전부 실제로 로컬 서버를 띄워 캡처한 값입니다 (조작된 예시 아님).

## 공통 사항

- 인증이 필요한 API는 헤더에 Firebase ID Token을 담아 보냅니다.
  ```
  Authorization: Bearer {Firebase ID Token}
  ```
- 에러 응답은 공통 형태입니다.
  ```json
  { "message": "에러 메시지", "error": "에러 종류", "statusCode": 400 }
  ```
- `Content-Type: application/json` 필수 (body가 있는 요청)

---

## Auth

### `POST /api/auth/register` — 회원가입

Firebase ID Token을 검증하고, 최초 1회 프로필(닉네임/국적)을 저장합니다. **재로그인 시 다시 호출하면 안 되고**, 재로그인 후에는 `GET /api/auth/me`로 가입 여부를 먼저 확인해야 합니다 (아래 참고).

| 항목 | 값 |
|---|---|
| Method | `POST` |
| URL | `/api/auth/register` |
| 인증 | 필요 (`Authorization: Bearer {Firebase ID Token}`) |

**Request Body**

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `nickname` | string | O | 2~20자 |
| `nationality` | string | O | ISO 3166-1 alpha-2 국가코드 2자 (예: `KR`, `JP`). 소문자로 보내도 서버가 대문자로 변환함 |

```json
{ "nickname": "여행자123", "nationality": "KR" }
```

**Response 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string (UUID) | 유저 고유 ID |
| `email` | string | Firebase 계정 이메일 |
| `nickname` | string | |
| `nationality` | string | |
| `team` | string | 가입 시 `nationality`와 동일하게 자동 설정됨 (국적=팀) |

**예시: 요청**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {Firebase ID Token}" \
  -d '{"nickname":"여행자123","nationality":"KR"}'
```

**예시: 실제 응답 (201 Created)**
```json
{
  "id": "2b97d658-cddc-4d11-8710-7a476e816530",
  "email": "doc-example-uid@example.com",
  "nickname": "여행자123",
  "nationality": "KR",
  "team": "KR"
}
```

**에러 케이스**

| 상황 | status | 실제 응답 |
|---|---|---|
| 토큰 없음 | 401 | `{"message":"Firebase ID Token이 필요합니다.","error":"Unauthorized","statusCode":401}` |
| 유효하지 않은 토큰 | 401 | `{"message":"유효하지 않은 토큰입니다.","error":"Unauthorized","statusCode":401}` |
| 이메일 정보가 없는 계정 (전화번호/익명 로그인 등) | 400 | `{"message":"이메일 정보가 있는 계정만 가입할 수 있습니다.","error":"Bad Request","statusCode":400}` |
| 이미 가입된 사용자로 재호출 | 409 | `{"message":"이미 가입된 사용자입니다.","error":"Conflict","statusCode":409}` (기존 프로필을 덮어쓰지 않고 그대로 유지. 동시 중복 요청이 경합한 경우에도 409) |

---

### `GET /api/auth/me` — 내 프로필 조회 (가입 여부 확인)

로그인/재로그인 직후 클라이언트가 가장 먼저 호출해야 하는 API입니다. **로그인 → `/auth/me` 호출 → 200이면 바로 앱 진입, 404면 회원가입 화면으로 이동 후 `register` 호출**하는 순서로 쓰면 됩니다.

| 항목 | 값 |
|---|---|
| Method | `GET` |
| URL | `/api/auth/me` |
| 인증 | 필요 |
| 파라미터 | 없음 |

**Response 필드** — `register` 성공 응답과 동일한 형태 (`id`, `email`, `nickname`, `nationality`, `team`)

**예시: 요청**
```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer {Firebase ID Token}"
```

**예시: 실제 응답 (200 OK, 가입된 사용자)**
```json
{
  "id": "2b97d658-cddc-4d11-8710-7a476e816530",
  "email": "doc-example-uid@example.com",
  "nickname": "여행자123",
  "nationality": "KR",
  "team": "KR"
}
```

**예시: 실제 응답 (404 Not Found, 미가입 사용자)**
```json
{ "message": "등록되지 않은 사용자입니다.", "error": "Not Found", "statusCode": 404 }
```

---

## Users

### `DELETE /api/users/me` — 회원 탈퇴 (계정 삭제)

앱스토어·플레이스토어가 계정 생성 앱에 요구하는 필수 기능입니다. **되돌릴 수 없습니다.**

**요청**

```
DELETE /api/users/me
Authorization: Bearer <Firebase ID Token>
```

**응답: `204 No Content`** (본문 없음)

**무엇이 지워지고 무엇이 남는지**

| 대상 | 처리 |
|---|---|
| 계정 정보(이메일·닉네임·국적) | 삭제 |
| Firebase 인증 계정 | 삭제 — 같은 이메일로 재가입 가능해집니다 |
| 진행 중인 결투 | **먼저 종료됩니다** — 대기 중이면 `EXPIRED`, 수락된 상태면 `VOID`. 상대에게 `duel:expired`/`duel:voided`가 갑니다 |
| 점령·점수·결투 기록 | **행은 남고 유저 참조만 끊깁니다.** 팀 점수와 상대방 전적이 보존됩니다 |
| 개인 랭킹(명예의 전당) | 탈퇴 즉시 노출되지 않습니다 (캐시도 함께 무효화됩니다) |
| 열려 있는 WebSocket 연결 | **즉시 끊깁니다** — `/realtime`·`/chat` 모두. 재연결하면 `connect_error`가 옵니다 |
| 미션 사진 원본(S3) | ⚠️ **현재 삭제되지 않습니다** — `docs/compliance.md` 5장 참고 |
| 위치정보 이용·제공사실 확인자료 | **6개월간 보존됩니다** — 위치정보법 제16조 2항 법정 의무 |

> 마지막 항목은 개인정보처리방침에도 동일하게 고지해야 합니다. 상세: `docs/compliance.md` 5장.

**멱등입니다.** 이미 탈퇴한 토큰으로 다시 호출해도 `404`가 아니라 `204`를 돌려줍니다 —
DB 삭제 직후 서버가 죽어 Firebase 계정만 남는 경우를 재시도로 정리할 수 있어야 하기
때문입니다. 클라이언트는 성공/실패만 보고 로그아웃 처리하면 됩니다.

**오류**

| 상태 | code | 설명 |
|---|---|---|
| 401 | — | 유효하지 않은 Firebase ID Token |

---

## Spots (관광지)

인증 불필요 — 로그인 없이 호출 가능합니다.

### `GET /api/spots` — 관광지 목록 조회

| 항목 | 값 |
|---|---|
| Method | `GET` |
| URL | `/api/spots` |
| 인증 | 불필요 |

**Query 파라미터**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `page` | number | X | 1 | 페이지 번호 |
| `limit` | number | X | 20 | 페이지당 개수 |
| `areacode` | string | X | - | 지역코드 (부산 = `6`) |
| `sigungucode` | string | X | - | 부산 구 코드 `1`~`16` (아래 코드표 참고) |
| `contenttypeid` | string | X | - | 콘텐츠 유형 코드 (아래 참고) |

**부산 구 코드표 (`sigungucode`)** — KTO 표준. 구 단위 점령 API(`/api/claims/districts/:sigungucode`)에도 동일하게 사용

> `1` 강서구 · `2` 금정구 · `3` 기장군 · `4` 남구 · `5` 동구 · `6` 동래구 · `7` 부산진구 · `8` 북구 · `9` 사상구 · `10` 사하구 · `11` 서구 · `12` 수영구 · `13` 연제구 · `14` 영도구 · `15` 중구 · `16` 해운대구

**콘텐츠 유형 코드 (`contenttypeid`)** — 데이터 소스에 따라 두 형식이 존재하니 주의

> - KTO 소스(115건): `12` 관광지 · `14` 문화시설 · `15` 축제공연행사 · `28` 레포츠 · `32` 숙박 · `38` 쇼핑 · `39` 음식점
> - 부산시 소스(100건): 문자열 `busan_attraction` (부산명소 — 대응되는 KTO 유형 코드가 없어 원본 값 유지)

**Response 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `items[]` | array | 아래 관광지 목록 |
| `items[].id` | number | |
| `items[].contentId` | string | 데이터셋 미션 ID (`MISSION_0001` 형식) |
| `items[].title` | string | 장소명 |
| `items[].addr1` | string \| null | 주소 |
| `items[].mapX` | number \| null | 경도. (Postgres `decimal`이지만 응답은 엔티티 `numericTransformer`로 number로 직렬화됩니다) |
| `items[].mapY` | number \| null | 위도. 위와 동일 |
| `items[].firstimage` | string \| null | 대표 이미지 URL |
| `items[].contenttypeid` | string \| null | |
| `items[].areacode` | string \| null | |
| `items[].sigungucode` | string \| null | |
| `total` | number | 조건에 맞는 전체 건수 |
| `page` | number | 요청한 페이지 |
| `limit` | number | 요청한 페이지당 개수 |

**예시: 요청** (해운대구 = `16`)
```bash
curl "http://localhost:3000/api/spots?page=1&limit=1&sigungucode=16"
```

**예시: 실제 응답 (200 OK)**
```json
{
  "items": [
    {
      "id": 818,
      "contentId": "MISSION_0005",
      "title": "해운대 빛축제",
      "addr1": "부산광역시 해운대구 해운대해변로 280 (중동)",
      "mapX": 129.1626049105,
      "mapY": 35.1595354549,
      "firstimage": "http://tong.visitkorea.or.kr/cms/resource/12/3576412_image2_1.jpg",
      "contenttypeid": "15",
      "areacode": "6",
      "sigungucode": "16"
    }
  ],
  "total": 48,
  "page": 1,
  "limit": 1
}
```

---

### `GET /api/spots/:id` — 관광지 상세 조회

| 항목 | 값 |
|---|---|
| Method | `GET` |
| URL | `/api/spots/:id` |
| 인증 | 불필요 |

**Path 파라미터**

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `id` | number | 관광지 ID (`GET /api/spots`의 `items[].id`) |

**Response 필드** — 목록 조회 필드 전부 + 아래 상세 필드 추가

| 필드 | 타입 | 설명 |
|---|---|---|
| `overview` | string \| null | 상세 설명 |
| `usetime` | string \| null | 이용 시간 |
| `homepage` | string \| null | 공식 홈페이지 |

**예시: 요청**
```bash
curl http://localhost:3000/api/spots/930
```

**예시: 실제 응답 (200 OK, `overview` 일부 생략)**
```json
{
  "id": 930,
  "contentId": "MISSION_0117",
  "title": "흰여울문화마을",
  "addr1": "부산광역시 영도구 흰여울길",
  "mapX": 129.04402,
  "mapY": 35.07885,
  "firstimage": "https://www.visitbusan.net/uploadImgs/files/cntnts/20191222164810529_ttiel",
  "contenttypeid": "busan_attraction",
  "areacode": "6",
  "sigungucode": "14",
  "overview": "절영해안산책로 가파른 담벼락 위로 독특한 마을 풍경이 보인다. (...생략)",
  "usetime": null,
  "homepage": "http://www.ydculture.com/huinnyeoulculturetown/"
}
```

**에러 케이스**

| 상황 | status | 실제 응답 |
|---|---|---|
| 존재하지 않는 id | 404 | `{"message":"Spot #9999를 찾을 수 없습니다.","error":"Not Found","statusCode":404}` |

---

## Claims / 실시간 API (병합됨 — 상세 문서화 예정)

아래는 이미 develop에 병합되어 동작 중인 엔드포인트 요약입니다. 상세 스펙(요청/응답 예시)은 추후 이 문서에 보강합니다.

| API | 브랜치 / PR | 설명 |
|---|---|---|
| `POST /api/claims/visit` | develop 병합됨 (PR #9, #19) | GPS 방문 인증 + 관광지 점령 (반경 50m). 관광지별 인당 하루 1회 제한(KST 자정 초기화) — 초과 시 `409 {"message":"이 관광지는 오늘 이미 점령했습니다. (KST 자정에 초기화)"}` |
| `GET /api/claims/spots/:spotId` | develop 병합됨 (PR #9) | 관광지 현재 점령 팀 조회 |
| `GET /api/claims/districts/:sigungucode` | develop 병합됨 (PR #9) | 구 단위 점령 현황 조회 (`sigungucode`는 위 부산 구 코드표와 동일) |
| WebSocket `location:update` / `duel:*` | develop 병합됨 (PR #13) | 실시간 조우 탐지, 결투 신청/수락/거절/결과 |

### 결투 거절·무응답 — 점수 차감 + 보호 기간

`duel:reject`를 보내거나 **30초 안에 응답하지 않아 만료되면**, 응답하지 않은 쪽에서 개인 점수
2점이 깎이고 **10분간 아무도 그 유저에게 결투를 걸 수 없는 보호 기간**이 붙습니다.
보호 기간 중에 **본인이 먼저 `duel:request`를 보내면 그 즉시 보호가 풀립니다**
(보호막 뒤에서 일방적으로 공격만 하는 것을 막기 위함).

거절과 무응답의 차감·보호 기간은 **완전히 동일**합니다. 무응답이 더 싸면 아무도 거절 버튼을
누르지 않고, 무응답에 보호막이 없으면 신청자가 30초마다 다시 걸어 자리를 비운 유저의 점수를
비용 없이 빨아낼 수 있습니다.

| 항목 | 값 |
|---|---|
| 차감 점수 | 2점 (개인 점수만 — 팀 점수는 결투로 변하지 않습니다) |
| 보호 기간 | 600초. 다시 거절/무응답하면 그때마다 새로 600초가 걸립니다 |
| 보호 해제 조건 | 만료 / 본인이 결투를 신청해 **신청이 실제로 성립**했을 때 (사거리 밖 등으로 튕기면 유지) |
| 원장 기록 | `score_events`에 한 줄 — 거절은 `DUEL_REJECT`, 무응답은 `DUEL_NO_RESPONSE` (둘 다 `personalPoints: -2`, `teamPoints: 0`) |
| 수락(`duel:accept`) | 차감도 보호막도 **없습니다** |
| 탈퇴로 끝난 결투 | 차감도 보호막도 **없습니다** — 아무도 응답을 회피한 것이 아닙니다 |

**`duel:rejected` / `duel:expired` payload** (양쪽 참가자에게 동일하게 갑니다)

```json
{
  "duelId": 12,
  "scorePenalty": 2,
  "penalizedUserId": "5f2c...",
  "shieldUntil": "2026-08-27T02:41:07.000Z"
}
```

| 필드 | 설명 |
|---|---|
| `scorePenalty` | 이번 종료로 깎인 점수. 차감이 없었으면 `0` |
| `penalizedUserId` | 깎이고 보호막을 받은 참가자. 없으면 `null` — **자기 id와 비교해서** 화면을 가르세요 |
| `shieldUntil` | 보호 기간이 끝나는 **절대 시각**(ISO). 없으면 `null` |

> `shieldUntil`이 남은 초가 아니라 절대 시각인 이유: 상대가 오프라인이면 이 알림이 최대 30분
> 큐에 있다가 재접속 시 재생됩니다. 남은 초를 보내면 이미 끝난 보호막에 대해 카운트다운을
> 새로 시작하게 됩니다. 재신청 가능 여부의 실제 판정은 언제나 서버가 다시 내립니다.

**`duel:request` 에러 케이스 (추가)**

| 상황 | code | 메시지 |
|---|---|---|
| 상대가 보호 기간 중 | `DUEL_TARGET_SHIELDED` | `상대가 결투 거절 보호 중입니다. (약 N분 후 해제)` |
