# 배포 (AWS EC2)

## 인프라

- EC2 t3.micro, ap-northeast-2(서울), Ubuntu 22.04, Elastic IP 고정
- 도메인: DuckDNS `b-territory.duckdns.org` (5분마다 자동 IP 갱신 cron, `~/duckdns/duck.sh`)
- 보안그룹: 22(관리자 IP만)/80/443만 개방 — 5432/6379는 외부에 절대 개방하지 않음
- 스왑 2GB (RAM 1GB라 Postgres+Redis+Node 동시 구동 대비)
- 스택: `docker-compose.prod.yml` — Postgres(PostGIS)/Redis/backend/Caddy, 전부 한 인스턴스에 컨테이너로 구동
  - Caddy가 80/443만 호스트에 노출하고 `backend:3000`으로 리버스 프록시 + Let's Encrypt 자동 HTTPS
  - Postgres/Redis는 컴포즈 네트워크 내부에서만 접근 가능 (호스트 포트 미노출)

## 배포 절차

```bash
ssh -i ~/.ssh/b_territory_aws.pem ubuntu@<EIP>
cd ~/B-Territory   # 최초엔 git clone
git pull origin develop
docker compose -f docker-compose.prod.yml up -d --build
```

## `backend/.env` (서버에만 존재, git에 커밋하지 않음)

`docker-compose.prod.yml`이 `backend/.env`를 읽되 `DB_HOST=postgres`/`REDIS_HOST=redis`/`NODE_ENV=production`은 컴포즈가 덮어쓴다. 나머지(Firebase, Resend, JWT 등)는 로컬 `.env`와 동일한 항목을 서버에 별도로 채워야 한다.

## 알려진 제약

- `NODE_ENV=production`이면 TypeORM `synchronize`가 꺼진다(`app.module.ts`). 마이그레이션 인프라(`feature/Bae/migration-setup`, PR #20)가 develop에 merge되기 전까지는 프로덕션 모드로 띄워도 스키마가 생성되지 않는다 — 배포 전에 해당 PR 머지 필요.
- 이미지가 `node_modules`를 dev 의존성 포함 전체로 담고 있다 (`migration:*`가 ts-node로 `src/migrations/*.ts`를 직접 실행하는데, `typescript` 패키지가 devDependencies에만 있어서 `--omit=dev`로는 마이그레이션 CLI가 동작하지 않기 때문). 이미지 용량보다 동작 확실성을 우선한 선택.
