# 배포 (AWS EC2)

## 인프라

- EC2 t3.micro, ap-northeast-2(서울), Ubuntu 22.04, Elastic IP 고정
- 도메인: DuckDNS `b-territory.duckdns.org` (5분마다 자동 IP 갱신 cron, `~/duckdns/duck.sh`)
- 보안그룹: 22(관리자 IP만)/80/443만 개방 — 5432/6379는 외부에 절대 개방하지 않음
- 스왑 2GB (RAM 1GB라 Postgres+Redis+Node 동시 구동 대비)
- 스택: `docker-compose.prod.yml` — Postgres(PostGIS)/Redis/backend/Caddy, 전부 한 인스턴스에 컨테이너로 구동
  - Caddy가 80/443만 호스트에 노출하고 `backend:3000`으로 리버스 프록시 + Let's Encrypt 자동 HTTPS
  - Postgres/Redis는 컴포즈 네트워크 내부에서만 접근 가능 (호스트 포트 미노출)
  - 프로젝트명은 `b-territory-prod` (compose 파일 `name:`). dev용 `docker-compose.yml`(프로젝트명 `b-territory`)과 컨테이너·볼륨이 분리되어 한 호스트에서 충돌 없이 공존한다.

> **기존에 프로젝트명 없이(`b-territory_*` 볼륨) 배포했던 인스턴스 주의**: `name: b-territory-prod` 도입으로 볼륨이 `b-territory-prod_*`로 바뀌므로, 다음 `up` 시 기존 `b-territory_postgres_data`/`b-territory_caddy_data` 대신 **빈 볼륨이 새로 생성**된다. 즉 DB 재초기화 + Let's Encrypt 인증서 재발급이 각각 1회 발생한다(인증서 재발급은 LE rate limit이 있으니 짧은 시간에 재배포를 반복하지 말 것). 기존 볼륨은 `docker volume ls`로 확인 후 정리한다.

## 배포 절차

```bash
ssh -i ~/.ssh/b_territory_aws.pem ubuntu@<EIP>
cd ~/B-Territory   # 최초엔 git clone
git pull origin develop
docker compose --env-file backend/.env -f docker-compose.prod.yml up -d --build
```

> **`--env-file backend/.env`는 필수다.** `docker-compose.prod.yml`의 `POSTGRES_PASSWORD: ${DB_PASSWORD}`, `ACME_EMAIL: ${ACME_EMAIL}`는 컴포즈 레벨 변수 치환이라, backend 서비스의 `env_file:`이 아니라 셸 환경 또는 `--env-file`/프로젝트 루트 `.env`에서만 값을 읽는다. `--env-file` 없이 띄우면 `DB_PASSWORD`가 빈 값으로 치환되어(경고: `The "DB_PASSWORD" variable is not set`) 최초 initdb가 `Database is uninitialized and superuser password is not specified`로 실패한다. (볼륨이 이미 초기화된 뒤라면 빈 값이어도 컨테이너는 뜨지만, 볼륨 재생성·인스턴스 교체 시 재현되므로 항상 붙인다.)

## `backend/.env` (서버에만 존재, git에 커밋하지 않음)

`docker-compose.prod.yml`이 `backend/.env`를 읽되 아래 값은 컴포즈가 덮어쓰므로 서버 `.env` 값과 무관하다:

- `DB_HOST=postgres`, `REDIS_HOST=redis`, `NODE_ENV=production`, `PORT=3000` — 컴포즈 `environment:`에서 고정.

주의할 항목:

- **`DB_PORT`/`REDIS_PORT`는 컴포즈가 덮어쓰지 않는다.** 컨테이너 내부는 항상 표준 포트(5432/6379)를 쓰므로, 로컬에서 포트 충돌을 피하려고 `DB_PORT=5433` 등으로 바꿔 쓰던 값을 그대로 복사하면 backend가 DB에 붙지 못한다. 서버 `.env`에서는 `DB_PORT=5432`/`REDIS_PORT=6379`로 두거나 아예 비워둔다.
- `ACME_EMAIL`(선택): Let's Encrypt 인증서 만료·발급 실패 알림을 받을 이메일. 미설정 시 도메인 기반 기본값(`admin@b-territory.duckdns.org`)이 쓰이며, 실제 알림을 받으려면 모니터링 중인 주소로 설정한다. (빈 값을 그대로 넘기면 Caddy가 기동하지 못하므로 기본값으로 대체하는 구조다.)
- 나머지(Firebase, Resend, JWT, `DB_USERNAME`/`DB_PASSWORD`/`DB_NAME` 등)는 로컬 `.env`와 동일한 항목을 서버에 별도로 채운다.

> **Postgres 비밀번호는 최초 1회만 반영된다.** `POSTGRES_PASSWORD`는 initdb(빈 볼륨 최초 기동) 시점에만 적용되므로, 이후 `.env`의 `DB_PASSWORD`를 바꿔도 기존 볼륨에는 반영되지 않는다. 비밀번호를 바꾸려면 볼륨을 재생성(`docker volume rm b-territory-prod_postgres_data`, 데이터 소실 주의)하거나 DB 안에서 직접 `ALTER USER`로 변경해야 한다.

## 마이그레이션 (스키마 생성/변경)

`NODE_ENV=production`에서는 TypeORM `synchronize`가 꺼지므로 스키마가 자동 생성되지 않는다. 배포 후 마이그레이션을 실행해야 테이블이 만들어진다.

**자동 배포(`deploy.yml`)가 이미 이 단계를 수행하므로 평소에는 수동 실행이 필요 없다.** 워크플로는 이미지 빌드 직후, `up` 이전에 아래와 동일한 명령을 돌린다. 아래는 배포 실패 복구나 수동 점검 등으로 직접 돌려야 할 때의 방법이다.

시딩과 마찬가지로 **일회성 `migrate` 서비스**로 실행한다(`--profile migrate`로만 뜨고, 끝나면 `--rm`으로 정리):

```bash
docker compose --env-file backend/.env -f docker-compose.prod.yml --profile migrate run --rm migrate
```

> `migrate`는 상시 `backend`와 같은 이미지·환경을 쓰지만 `container_name`이 없다. 상시 `backend`에는 `container_name: b-territory-prod-backend`가 고정돼 있어서, 일회성 실행(`run`)에 그 서비스를 쓰면 이미 떠 있는 컨테이너와 이름이 충돌한다(`Conflict. The container name ... is already in use`). 그래서 `seed`와 동일하게 이름 없는 전용 서비스를 둔다 — 일회성 실행에는 `container_name`을 붙이지 않는다는 규칙이다.

`backend` 컨테이너가 이미 떠 있는 상태라면 그 안에서 바로 실행해도 된다:

```bash
docker compose --env-file backend/.env -f docker-compose.prod.yml exec backend npm run migration:run
```

> 다만 `exec`는 backend가 실행 중일 때만 동작한다. 최초 배포처럼 스키마가 없는 상태에서는 `up` 이전에 마이그레이션을 돌려야 하므로 위의 `migrate` 서비스를 쓴다.

## 관광지 데이터 시딩

마이그레이션은 빈 테이블만 만든다. 지도 마커·GPS 점령 인증 등이 동작하려면 관광지 데이터(`data/mission_places_final.csv`)를 `spots` 테이블에 넣어야 한다. 시딩은 상시 앱(`backend`)이 아니라 **일회성 `seed` 서비스**로 실행한다(`--profile seed`로만 뜨고, 끝나면 `--rm`으로 정리):

```bash
docker compose --env-file backend/.env -f docker-compose.prod.yml --profile seed run --rm seed
```

> CSV는 이미지에 포함되지 않고(빌드 컨텍스트가 `backend/`라 레포 루트의 `data/`를 담지 못함), `seed` 서비스가 호스트 레포의 `data/`를 컨테이너 `/data`로 읽기전용 마운트해 제공한다. 따라서 **레포를 clone한 디렉터리에서(즉 `data/`가 존재하는 상태로) 컴포즈를 실행**해야 시딩이 동작한다. 마이그레이션(위 `migrate` 서비스)을 먼저 실행해 테이블이 존재해야 한다. `seed`는 `profiles`로 묶여 있어 일반 `up`으로는 뜨지 않으므로, 상시 `backend` 컨테이너에는 `data/` 마운트가 붙지 않는다.

## 알려진 제약 / 참고

- 이미지가 `node_modules`를 dev 의존성 포함 전체로 담고 있다 (`migration:*`가 ts-node로 `src/migrations/*.ts`를 직접 실행하는데 `typescript`가 devDependencies에만 있기 때문). 이미지 용량보다 동작 확실성을 우선한 선택이며, 향후 마이그레이션을 컴파일된 `dist/data-source.js` 기반으로 돌리면 `--omit=dev`로 이미지를 줄일 수 있다 (PR #20과 함께 후속 처리).
- Caddy가 노출하는 `/api/docs`·`/api/docs-json`은 현재 인증 없이 공개다. 프론트 참고용으로 의도된 상태이며, 실사용자 가입이 열리는 시점에 프로덕션에서 비활성화하거나 Caddy `basic_auth`로 보호하는 것을 검토한다.
- 로그는 서비스별 `json-file` 10MB×3개로 로테이션되고, redis는 `maxmemory 256mb`/`noeviction`으로 제한된다 (RAM 1GB 환경 보호).
