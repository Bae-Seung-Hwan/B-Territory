# 배포 체크리스트

배포·환경 갱신 시 놓치기 쉬운 항목을 기록합니다. 새 항목이 생기면 여기에 추가하세요.

## 관광지 시딩 (`npm run seed:spots`)

- [ ] **구 KTO 시딩 잔여 행 정리 여부 확인** — CSV 시딩 전환(PR #16) 이전에 구 `seed-spots.ts`(제거됨)를 실행했던 환경(dev/staging 등)은 spots 테이블에 KTO 원본 행(약 813건, `contentId`가 `MISSION_` 형식이 아님)이 남아 있을 수 있습니다. `seed:spots`는 이 중 **점령 기록(spot_claims)이 없는 행은 자동으로 삭제**합니다(로그: "점령 기록이 없는 N건을 자동 삭제했습니다"). 이미 점령된 행은 삭제해도 잃을 게 없다고 판단할 수 없어 자동 삭제하지 않고 경고만 남기니, 그 경우 아래 절차로 수동 정리하세요.
  ⚠️ 이 잔여 행을 방치하면 단순 중복 노출에 그치지 않습니다 — legacy sigungucode 포맷(예: `"6-2"`)이 신규 KTO 코드(예: `"16"`)와 물리적으로 같은 구를 가리켜, 구 점령 집계(`aggregateDistricts`의 `GROUP BY sigungucode`)가 같은 구를 두 개로 쪼갭니다. 이 PR이 애초에 고치려던 버그가 재발하는 것이며, `GET /api/spots`·`POST /api/claims/visit` 어디에도 `MISSION_` 접두사 필터가 없어 사용자가 잔여 행 위치에서 정상적으로 방문 인증만 해도 새로 쪼개짐이 발생할 수 있습니다.
  ⚠️ `SpotClaim.spot` FK는 `onDelete: 'CASCADE'`입니다 — `spots` 행을 지우면 연결된 `spot_claims`(점령 기록)가 **에러도 경고도 없이 함께 삭제**됩니다.
  ```sql
  SELECT COUNT(*) FROM spot_claims
  WHERE "spotId" IN (SELECT id FROM spots WHERE "contentId" NOT LIKE 'MISSION%');
  ```
  0건이 아니면 즉시 삭제하지 말고 점령 기록을 보존할 방법(이관/백업)을 먼저 검토한 뒤 정리하세요. 위 SQL로 확인한 개수가 시딩 로그의 "점령 기록이 있어 자동 삭제하지 못한 구 KTO 잔여 행" 경고 건수와 일치해야 합니다.
- [ ] **시딩 로그의 경고 확인** — "현재 CSV에 없는 MISSION 행" 경고가 뜨면 데이터팀이 CSV에서 제거한 장소(폐업·오류 등)가 DB에 남은 것이므로, 마찬가지로 `spot_claims` 확인 후 정리합니다.
- [ ] 시딩이 에러로 중단되면 CSV 자체 문제입니다 (알 수 없는 `sigungu_code`, 중복 `mission_id` 등 — 에러 메시지에 원인 표시). DB는 트랜잭션으로 보호되므로 CSV 보정 후 재실행하면 됩니다.

## 축제 시딩 (`npm run seed:festivals`)

- [ ] **최초 배포 시 1회 실행** — `festivals` 테이블의 초기 데이터를 `data/festivals.csv`에서 채웁니다. 이후 최신화는 매일 04:00 KST TourAPI 동기화(`festival-sync` 큐)가 이어받으므로 반복 실행할 필요는 없습니다. `--dry-run`으로 반영 없이 미리 볼 수 있습니다.
- [ ] **"날짜가 없어 스킵" 경고 확인** — 최종 `data/festivals.csv`는 날짜 보정이 끝난 행만 담습니다. 날짜가 없는 원본 행은 `data/festivals_removed_missing_dates.csv`로 분리되어 있으므로, 이 경고가 뜨면 데이터 회귀로 보고 CSV를 먼저 확인하세요.
- [ ] **"현재 조회에 잡히는 축제" 건수 확인** — 시딩 직후 로그에 종료되지 않은 축제 수가 찍힙니다. 종료된 축제는 `GET /api/festivals` 기본 조회에서 보이지 않으므로, 시연 전에는 이 숫자가 예상과 맞는지 확인하세요.
- [ ] 시딩은 **삭제를 하지 않습니다** — 테이블 정리는 동기화(`syncFromApi`)가 "이미 종료됐고 API가 더 이상 주지 않는 축제"만 지우는 방식으로 담당합니다. 따라서 시딩한 종료 축제는 이후 동기화에서 정리될 수 있습니다(진행 중·예정 축제는 API가 누락해도 보존).

## 구 `spot-sync` BullMQ 잡 잔여 키 (Redis)

- [ ] **구 KTO 주간 재동기화 잡의 Redis 잔여 키 정리 확인** — CSV 시딩 전환(PR #16) 이전 코드를 실행했던 환경의 Redis에는 제거된 `spot-sync` 반복 잡 스케줄(`bull:spot-sync:*`)이 남아 있습니다. **앱을 한 번 기동하면 부팅 시 자동 정리**되며(`SpotsModule` 로그 "구 spot-sync 반복 잡 잔여 키 N개를 정리했습니다" 확인), 앱을 띄우지 않는 환경이라면 `redis-cli --scan --pattern 'bull:spot-sync:*'`로 확인 후 `UNLINK`로 수동 삭제하세요. 방치하면 향후 같은 이름의 큐를 재도입할 때 옛 cron 스케줄과 충돌할 수 있습니다.
