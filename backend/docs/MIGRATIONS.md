# DB 마이그레이션 가이드

## 배경

- **dev/test**: `synchronize: true` — 엔티티 변경이 스키마에 자동 반영됩니다 (기존 워크플로 그대로).
- **production**: `synchronize: false`. 프로덕션 스키마를 바꾸는 유일한 수단이 마이그레이션이므로,
  **엔티티를 바꾸는 PR은 반드시 마이그레이션 파일을 함께 포함해야 합니다.**

## 배포 시 마이그레이션 실행 (앱 자동 실행 아님)

앱은 부팅 시 마이그레이션을 자동 실행하지 않습니다(`migrationsRun` 미사용). 인스턴스가 둘 이상
겹쳐 뜨는 순간(레플리카 다중 운영, 롤링 재배포 중 신/구 인스턴스 겹침 구간)마다 TypeORM이 부팅 시
확인 후 생성하는 `migrations` 북키핑 테이블 생성 단계에서 경쟁 상태가 재현되기 때문입니다 — 한쪽은
`duplicate key value violates unique constraint` 로 크래시하고, pending 마이그레이션 유무와 무관하게
발생합니다.

대신 **새 인스턴스를 띄우기 전, 배포 파이프라인의 별도 1회성 스텝**에서 아래를 실행하세요:

```bash
npm run migration:run
```

단일 프로세스로 한 번만 실행되도록 보장하는 것이 이 스텝의 역할입니다 (동시 실행 금지).

## 새 마이그레이션 만들기

dev DB는 synchronize가 이미 스키마를 바꿔버려서 diff가 비어 나옵니다. **빈 임시 DB를 기준으로 생성**하세요:

```bash
# 1) 빈 임시 DB 생성 (WSL/psql 환경에 맞게)
psql -U postgres -c 'CREATE DATABASE b_territory_migration_gen'

# 2) 기존 마이그레이션을 임시 DB에 적용
DB_NAME=b_territory_migration_gen npm run migration:run

# 3) 엔티티와의 diff로 마이그레이션 생성
DB_NAME=b_territory_migration_gen npm run migration:generate -- src/migrations/<변경내용이름>

# 4) 검증: 다시 generate 했을 때 "No changes"가 나와야 함
DB_NAME=b_territory_migration_gen npm run migration:generate -- src/migrations/ShouldBeEmpty

# 5) 임시 DB 정리
psql -U postgres -c 'DROP DATABASE b_territory_migration_gen'
```

생성된 파일을 열어 확인하세요 — 특히 **컬럼 삭제/타입 변경이 데이터 손실을 일으키지 않는지**. 필요하면 데이터 이관 SQL을 직접 추가합니다.

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run migration:run` | pending 마이그레이션 실행 (`.env`의 DB 대상) |
| `npm run migration:revert` | 마지막 마이그레이션 1개 되돌리기 |
| `npm run migration:show` | 실행/미실행 마이그레이션 목록 |
| `npm run migration:generate -- src/migrations/<이름>` | 엔티티↔DB diff로 생성 |
| `npm run migration:create -- src/migrations/<이름>` | 빈 마이그레이션 생성 (데이터 이관 등 수동 SQL용) |

CLI 접속 정보는 `src/data-source.ts`가 `.env`에서 읽으며, `DB_NAME=... npm run ...`처럼 환경변수로 덮어쓸 수 있습니다.

## 주의사항

- **확장(Extension)**: `InitialSchema` 마이그레이션이 `uuid-ossp`(users.id 기본값)와 `postgis`(GPS 검증 쿼리)를 `CREATE EXTENSION IF NOT EXISTS`로 설치합니다. 관리형 PG(RDS 등)는 마스터 계정으로 실행하면 됩니다. synchronize는 uuid-ossp를 자동 설치하지만 **마이그레이션은 명시해야** 합니다.
- **down()에서 확장을 드롭하지 마세요** — 다른 객체가 공유할 수 있습니다.
- 이미 synchronize로 스키마가 만들어진 DB(초기 프로덕션 등)에 마이그레이션을 도입하려면, 테이블이 이미 존재하므로 `InitialSchema`를 실행 없이 기록만 해야 합니다:
  `INSERT INTO migrations("timestamp", "name") VALUES (1784180425289, 'InitialSchema1784180425289');`
