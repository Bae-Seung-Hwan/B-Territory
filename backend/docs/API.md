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
| `items[].mapX` | **string** | 경도. ⚠️ **숫자가 아니라 문자열로 옵니다** (Postgres `decimal` 컬럼 특성). 프론트에서 `parseFloat` 필요 |
| `items[].mapY` | **string** | 위도. 위와 동일 |
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
      "mapX": "129.1626049105",
      "mapY": "35.1595354549",
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
  "mapX": "129.0440200000",
  "mapY": "35.0788500000",
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
