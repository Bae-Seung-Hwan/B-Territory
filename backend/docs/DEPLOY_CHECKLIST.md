# 배포 체크리스트

배포·환경 갱신 시 놓치기 쉬운 항목을 기록합니다. 새 항목이 생기면 여기에 추가하세요.

## 관광지 시딩 (`npm run seed:spots`)

- [ ] **구 KTO 시딩 잔여 행 정리 여부 확인** — CSV 시딩 전환(PR #16) 이전에 구 `seed-spots.ts`(제거됨)를 실행했던 환경(dev/staging 등)은 spots 테이블에 KTO 원본 행(약 813건, `contentId`가 `MISSION_` 형식이 아님)이 남아 CSV 행과 같은 장소가 중복 노출됩니다. `seed:spots` 실행 시 "CSV 출처가 아닌 기존 행" 경고가 뜨면, 점령 데이터(`spot_claims`) FK를 확인한 뒤 해당 행을 수동 정리(또는 DB 초기화)하세요. 스크립트는 안전을 위해 자동 삭제하지 않습니다.
- [ ] **시딩 로그의 경고 확인** — "현재 CSV에 없는 MISSION 행" 경고가 뜨면 데이터팀이 CSV에서 제거한 장소(폐업·오류 등)가 DB에 남은 것이므로, 마찬가지로 `spot_claims` 확인 후 정리합니다.
- [ ] 시딩이 에러로 중단되면 CSV 자체 문제입니다 (알 수 없는 `sigungu_code`, 중복 `mission_id` 등 — 에러 메시지에 원인 표시). DB는 트랜잭션으로 보호되므로 CSV 보정 후 재실행하면 됩니다.

## 구 `spot-sync` BullMQ 잡 잔여 키 (Redis)

- [ ] **구 KTO 주간 재동기화 잡의 Redis 잔여 키 정리 확인** — CSV 시딩 전환(PR #16) 이전 코드를 실행했던 환경의 Redis에는 제거된 `spot-sync` 반복 잡 스케줄(`bull:spot-sync:*`)이 남아 있습니다. **앱을 한 번 기동하면 부팅 시 자동 정리**되며(`SpotsModule` 로그 "구 spot-sync 반복 잡 잔여 키 N개를 정리했습니다" 확인), 앱을 띄우지 않는 환경이라면 `redis-cli --scan --pattern 'bull:spot-sync:*'`로 확인 후 `UNLINK`로 수동 삭제하세요. 방치하면 향후 같은 이름의 큐를 재도입할 때 옛 cron 스케줄과 충돌할 수 있습니다.
