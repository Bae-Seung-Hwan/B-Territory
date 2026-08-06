# 0002. 점령 미션 확장성 (프론트엔드만)

## 배경

점령 시도는 현재 "GPS로 관광지 50m 이내 접근"(`GPS_VISIT`) 한 종류뿐이지만, 사진 인증·퀴즈·QR 스캔 같은 다른 미션이 나중에 추가될 수 있다는 요구가 있었다.

처음에는 백엔드(`ClaimsService.visit()`)와 프론트를 동시에 리팩터링해서 미션별 검증 로직을 분리하는 `ClaimMissionVerifier` 구조(`backend/src/claims/missions/`)까지 만들었으나, "백엔드는 수정하면 안 된다"는 지시에 따라 **백엔드는 리팩터링 이전 상태(단일 `visit()`, `POST /api/claims/visit`)로 되돌렸다.** 이 문서는 그 이후 남은 **프론트엔드 전용** 확장 구조를 기록한다.

## 결정

프론트엔드는 미션이 여러 개로 늘어나도 "버튼을 그리고 → 시도를 보내고 → 결과 문구를 만드는" 공통 로직은 건드리지 않고, 아래 네 곳에 정의만 추가하면 새 미션이 화면에 나타나도록 짰다.

| 파일 | 역할 | 새 미션 추가 시 |
|---|---|---|
| `src/api/claims.ts` | `MissionType`/`ClaimMission` 유니온, `requestOf()`가 미션→엔드포인트·바디 매핑 | 유니온에 멤버 추가 + `requestOf`에 `case` 추가 |
| `src/constants/claimMissions.ts` | `availableMissions()`가 "지금 이 관광지에서 시도 가능한 미션 목록" 조립, `missionButtonKey`/`missionRejectedKey`로 i18n 키 규칙 통일 | 목록에 항목 추가(그 미션이 필요로 하는 입력을 `MissionInputs`에 추가) |
| `src/i18n/locales/{ko,en}.ts` | `map.missions.<TYPE>.{button,rejected,blocked}` | 미션별 문구 3줄 |
| `src/hooks/use-claim-attempt.ts` | 미션과 무관한 공통 mutation + 상태코드별 에러 메시지 | 보통 수정 불필요 (400 사유만 `missionRejectedKey`로 위임) |

`SpotDetailSheet.tsx`는 고정된 버튼 하나 대신 `availableMissions(...).map(...)`로 렌더링하므로, 미션이 늘어도 이 파일은 그대로 둔다.

## 이유

- 미션마다 갈리는 지점(엔드포인트, 요청 바디, 필요한 입력, 문구)을 표 안의 네 파일에만 모아두면, 화면 컴포넌트·mutation 훅은 미션 개수와 무관하게 안정적으로 유지된다.
- 백엔드를 바꿀 수 없는 지금 시점에도 프론트 구조만 미리 준비해두면, 실제로 새 엔드포인트가 생겼을 때 프론트 쪽 변경 범위가 위 네 곳으로 예측 가능해진다.

## 한계 (중요)

**실제 판정 로직은 전부 백엔드 `ClaimsService.visit()` 안에 있고, 지금은 "GPS 50m 이내"라는 조건 하나만 하드코딩되어 있다.** 프론트에 `ClaimMission`을 추가해도 대응하는 백엔드 엔드포인트가 없으면 요청은 404로 실패한다. 즉 이 구조는 "새 미션이 왔을 때 프론트를 어디서부터 고치면 되는가"에 대한 답이지, 새 미션이 지금 바로 동작한다는 뜻은 아니다.

실제 미션을 추가하려면:
1. 백엔드에 `POST /api/claims/<mission>` 같은 새 엔드포인트(또는 되돌렸던 `ClaimMissionVerifier` 분리 구조 재도입)가 먼저 필요
2. 위 표의 네 파일에 프론트 쪽 매핑 추가

두 작업이 함께 있어야 새 미션이 실제로 동작한다.
