# CI/CD — develop 자동 배포 (EC2 self-hosted 러너)

`develop`에 백엔드 관련 변경이 push되면 `.github/workflows/deploy.yml`이 EC2에서 프로덕션
스택을 재빌드·재기동한다. **EC2 안에 설치한 self-hosted 러너**가 GitHub로 아웃바운드 폴링만
하므로, 보안그룹의 `22=관리자 IP만` 규칙을 완화하지 않아도 된다(인바운드 SSH 개방 불필요).

## 배포 흐름 (workflow가 하는 일)

배포는 **테스트 게이트(`test` job) → 배포(`deploy` job)** 두 단계다.

0. **`test`** — `ci.yml`을 재사용 워크플로로 호출해 lint·build·unit·마이그레이션 정합성·e2e를
   GitHub 호스티드 러너에서 돌린다. 실패하면 `deploy` job은 아예 시작하지 않는다.
   develop은 룰셋으로 보호되지만 그것만으로는 테스트 통과가 보장되지 않는다(아래 참조).

`deploy` job (self-hosted 러너, `DEPLOY_DIR=/home/ubuntu/B-Territory`):

1. `git fetch` + `git reset --hard ${{ github.sha }}` — **트리거한 커밋**으로 서버 클론을 맞춘다
   (`origin/develop`이 아니라 그 커밋 — 연속 push 시 실제 배포된 코드를 특정할 수 있어야 하므로).
   되돌아갈 지점(`PREV_SHA`)을 먼저 기록한다.

   > 무엇이 보존되는가: `reset --hard`는 **추적 파일만** 되돌리고 untracked 파일은 건드리지
   > 않는다. `backend/.env`가 살아남는 건 루트 `.gitignore`의 `.env` 패턴 덕에 애초에 추적되지
   > 않기 때문이다. 반면 **`data/`는 git에 추적되므로**(`git ls-files data`) 서버에서 손댄
   > 내용은 develop 기준으로 되돌아간다 — 위 트리거의 `data/**`가 성립하는 것도 그래서다.
   > 서버에만 두어야 하는 파일은 반드시 gitignore 대상이어야 한다.
2. 현재 이미지를 `b-territory-prod-backend:rollback`으로 태깅 — 실패 시 재빌드 없이 되돌리기 위함.
3. `docker compose ... build` — 백엔드 이미지 빌드.
4. `docker compose ... run --rm backend npm run migration:run` — **앱 기동 전에** 마이그레이션.
   일회성 컨테이너라 최초 배포(빈 DB)에서도 앱 부팅 시딩에 걸리지 않고 테이블을 먼저 만든다.
5. `docker compose ... up -d --remove-orphans --wait --wait-timeout 120` — backend + caddy 기동.
   `--wait`로 healthcheck가 healthy가 될 때까지 기다리고, 제한시간 내 못 되면 스텝을 실패시킨다.
6. 실패 시: 서비스 상태·백엔드 로그 덤프 → **직전 커밋·직전 이미지로 자동 롤백**.
7. 성공 시에만 `docker image prune -f` — 이전 빌드 레이어 정리(EBS 절약).

트리거: `develop` push 중 `backend/**`·`docker-compose.prod.yml`·`Caddyfile`·`data/**`·워크플로
파일 변경 시. 수동 실행은 GitHub Actions 탭의 **Run workflow**(workflow_dispatch).

> **보안**: 이 레포는 퍼블릭이고 `deploy` job은 프로덕션 서버의 러너에서 돈다(docker 소켓
> 접근 = root 상당). `deploy.yml`에 **`pull_request` 트리거를 추가하면 안 된다** — 포크에서 온
> 임의의 코드가 서버에서 실행된다. 현재 트리거는 `push`(develop)와 수동 실행뿐이다.

## 헬스체크와 배포 게이트

`docker-compose.prod.yml`의 backend healthcheck는 `GET /api/health`를 본다. 루트(`GET /api`)는
정적 문자열이라 DB가 죽어도 200이 나와서, "떠 있지만 아무것도 못 하는" 인스턴스를 걸러내지
못하기 때문이다. 의존성을 등급으로 나눠 판정한다:

| 상태 | 응답 | 배포 |
|---|---|---|
| DB·Redis 정상 | `200 {"status":"ok"}` | 통과 |
| Redis 불가 | `200 {"status":"degraded","redis":"down"}` | **통과** |
| DB 불가 | `503` | 실패 → 롤백 |

Redis 불가를 통과시키는 것은 의도된 설계다. 앱은 Redis 장애를 캐시 미스로 흡수하고 DB 원장으로
폴백하도록 만들어져 있어서, 여기서 503을 내면 그 설계와 모순되고 배포 중 일시적인 Redis 순단이
멀쩡한 배포를 실패시킨다. 상태는 응답 본문에 남아 모니터링에서 확인할 수 있다.

> **이 healthcheck는 배포 게이트이지 상시 감시가 아니다.** 도커는 컨테이너가 unhealthy가 됐다고
> 재시작하지 않고, `restart: unless-stopped`도 프로세스 종료(exit)에만 반응한다. 배포 이후 앱이
> 멈추면 `docker ps`에 unhealthy로 표시될 뿐 자동 조치가 없다. 런타임 자동 복구(autoheal
> 컨테이너)나 외부 모니터링/알림은 **아직 없으며 별도 과제**다.

## 마이그레이션 작성 원칙 (expand-contract)

4단계(마이그레이션)와 5단계(`up`) 사이에는 **구버전 앱이 새 스키마 위에서 돈다.** 컬럼 삭제나
이름 변경 같은 파괴적 마이그레이션은 그 구간에 구버전을 깨뜨리고, 자동 롤백으로도 복구되지
않는다(롤백은 코드·이미지만 되돌리고 스키마는 그대로 둔다 — down 마이그레이션 자동 실행은
데이터 손실 위험이 더 크다).

따라서 스키마 변경은 두 배포에 나눠 적용한다:

1. **expand** — 컬럼/테이블 추가, 새 코드가 신·구 양쪽을 읽을 수 있게. 이 배포는 롤백 가능하다.
2. **contract** — 구버전이 완전히 사라진 뒤, 다음 배포에서 옛 컬럼을 제거.

## EC2 최초 1회 — 러너 설치

전제: `DEPLOY_DIR`에 레포가 clone돼 있고 `backend/.env`가 채워져 있으며, 최소 1회 수동 배포가
성공한 상태(= docker/compose 동작 확인). `ubuntu` 사용자가 `docker`를 sudo 없이 실행 가능해야
한다(`sudo usermod -aG docker ubuntu` 후 재로그인).

**Docker Compose v2.17.0 이상**이 필요하다 — `up --wait-timeout`이 그 이후 버전에서 추가됐고,
배포 게이트가 이 옵션에 의존한다. 워크플로 첫 스텝이 지원 여부를 확인해 미지원이면 서버 상태를
건드리기 전에 멈추지만, 설치 시점에 미리 맞춰두는 편이 낫다:

```bash
docker compose version
docker compose up --help | grep -- --wait-timeout   # 출력이 있어야 한다
```

### 보안 전제 — PUBLIC 레포 + self-hosted 러너

이 레포는 퍼블릭이고 러너는 프로덕션 서버 안에서 돈다. 러너는 특정 워크플로가 아니라 **레포의
모든 워크플로에 대해 대기**하므로, 누군가 fork PR로 `runs-on: [self-hosted, b-territory-prod]`
워크플로를 추가하고 그 실행이 승인되면 EC2에서 임의 코드가 실행된다. 러너 계정(`ubuntu`)은
docker 그룹 소속이라 사실상 호스트 root이고, `DEPLOY_DIR`의 `backend/.env`에 DB 비밀번호 등이
있다. 따라서 아래 설정이 전제 조건이다.

조회: `gh api repos/<owner>/<repo>/actions/permissions/{,workflow,fork-pr-contributor-approval}`

| 설정 | 현재 (2026-08-07 확인) | 권장 |
|---|---|---|
| 기본 `GITHUB_TOKEN` 권한 | `read` ✅ | read |
| PR 승인 권한 | `false` ✅ | false |
| **fork PR 실행 승인 정책** | **`first_time_contributors`** ⚠️ | `all_external_contributors` |

`first_time_contributors`는 GitHub 기본값으로, **한 번이라도 기여한 적 있는 외부 사용자의 fork
PR은 승인 없이 워크플로가 실행된다.** 퍼블릭 레포 + 프로덕션 러너 조합에서는
Settings → Actions → General → Fork pull request workflows를
**"Require approval for all external contributors"**로 올리는 것을 권장한다.

`deploy.yml`의 `deploy` job에는 `permissions: {}`를 명시해 두었다(토큰을 쓰지 않으므로).
`deploy.yml`에 **`pull_request` 트리거를 추가하면 안 된다** — 위 경로가 승인 없이 열린다.

1. GitHub 레포 → **Settings → Actions → Runners → New self-hosted runner** → Linux/x64 선택.
   화면에 나오는 `download`/`config.sh` 명령을 **그대로 복붙**해 실행한다(토큰 포함).

   ```bash
   # 예시(실제 URL/토큰은 GitHub 화면 값으로)
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-linux-x64.tar.gz -L <GitHub가_준_URL>
   tar xzf actions-runner-linux-x64.tar.gz
   # --labels b-territory-prod 는 필수 — deploy.yml의 runs-on: [self-hosted, b-territory-prod]와
   # 일치해야 이 러너가 배포 job을 받는다. 라벨이 다르면 job이 큐에 걸린 채 실행되지 않는다.
   ./config.sh --url https://github.com/<owner>/<repo> --token <GitHub가_준_토큰> --labels b-territory-prod
   ```

2. **서비스로 등록**해 부팅 시 자동 시작 + 상시 대기하게 한다(터미널을 닫아도 유지):

   ```bash
   sudo ./svc.sh install ubuntu
   sudo ./svc.sh start
   sudo ./svc.sh status   # active(running) 확인
   ```

3. GitHub → Settings → Actions → Runners에 러너가 **Idle**로 뜨면 준비 완료.

> 러너는 `ubuntu` 권한으로 `DEPLOY_DIR`에서 docker를 실행한다. 워크플로가 `cd $DEPLOY_DIR`
> 후 compose를 돌리므로, 러너 계정이 그 디렉터리와 docker 소켓에 접근 가능해야 한다.

## develop 보호 현황과 배포 게이트가 필요한 이유

develop은 룰셋 **`develop-protection`**(active)으로 보호된다. 조회: `gh api
repos/<owner>/<repo>/rules/branches/develop`.
(주의: `gh api .../branches/develop/protection`은 classic branch protection 전용이라
룰셋 기반 보호에는 404를 반환한다 — "보호 없음"으로 오독하기 쉽다.)

| 항목 | 현재 |
|---|---|
| PR 필수 + 승인 | 1건 |
| 우회 허용 대상(`bypass_actors`) | 없음 — 소유자도 직접 push 불가 |
| 강제 push / 브랜치 삭제 | 차단 |
| **status check 통과 요구** | **없음** |
| 승인 후 push 시 승인 무효화 | 안 함 |
| 허용 머지 방식 | merge, squash, rebase |

즉 **리뷰 없는 직접 push는 불가능하지만, 테스트 통과는 머지 조건이 아니다.** 배포 워크플로가
`test` job을 게이트로 두는 것은 그 간극 때문이다:

- CI가 실패했거나 아예 돌지 않은 PR도 승인 1건이면 머지된다
- "머지 전 최신화" 요구가 없어, 머지 결과 조합은 CI를 거친 적이 없을 수 있다
- 승인 후 밀어넣은 커밋은 재승인 없이 머지된다
- `workflow_dispatch` 수동 배포는 PR 경로를 아예 타지 않는다

### 룰셋에 추가하면 좋은 것 (선택)

Settings → Rules → `develop-protection`:

- **Require status checks to pass** → `Backend Lint & Build`
  (머지 시점에도 걸러져, 실패하는 PR이 develop에 들어와 배포 게이트에서 되튕기는 낭비가 준다)
- **Require branches to be up to date before merging**
- **Dismiss stale reviews on push**

> 머지 방식 주의: 의존 관계가 있는 PR(예: 기능 브랜치를 base로 삼은 후속 PR)이 열려 있을 때
> base PR을 **squash/rebase로 머지하면 커밋 해시가 새로 만들어져** 후속 PR의 base 재지정이
> 깨진다(변경분 전체가 diff에 다시 나타나고 대량 충돌). 그 경우 merge commit을 쓸 것.

## 적용 순서 (중요)

`deploy.yml`은 **develop에 있어야** 트리거된다. 이 브랜치(`feature/Bae/cd-auto-deploy`)를
develop에 merge한 뒤부터 자동 배포가 동작한다. merge 후 첫 배포는 GitHub Actions 탭에서
**Run workflow**로 수동 트리거해 한 번 검증하는 것을 권장한다.

## 롤백 / 트러블슈팅

- **배포 실패 시 자동 롤백**: 5단계(`--wait`)가 실패하면 워크플로가 `PREV_SHA`로 `git reset`하고
  보존해둔 `:rollback` 이미지로 재기동한다(재빌드 없음). Actions 로그에 경고로 남는다.
  **스키마는 되돌아가지 않는다** — expand-contract를 지켰다면 구버전이 새 스키마에서 정상
  동작하므로 이것만으로 복구된다.
- **자동 롤백까지 실패한 경우**(최초 배포라 `:rollback` 이미지가 없거나, 롤백 자체가 헬스체크
  실패): 프로덕션이 내려간 상태다. 서버에서 수동으로
  `cd $DEPLOY_DIR && git reset --hard <정상_sha> && docker compose --env-file backend/.env
  -f docker-compose.prod.yml up -d --build`.
- **마이그레이션 실패로 배포 중단**: 워크플로가 4단계에서 멈춘다(앱은 기존 버전 그대로 유지 —
  아직 `up`을 안 했으므로 무중단). 마이그레이션을 고쳐 다시 push한다.
- **헬스체크가 계속 실패**: `docker compose ... logs backend`로 확인. `/api/health` 응답의
  `db`/`redis` 필드가 어느 의존성이 문제인지 알려준다. `db: "down"`이면 postgres 컨테이너
  상태와 `backend/.env`의 DB 접속 정보를 본다.
- **배포 후 앱이 멈춘 경우**: 자동 조치가 없다(위 "배포 게이트이지 상시 감시가 아니다" 참조).
  `docker ps`에 unhealthy로 보이면 `docker compose ... restart backend`로 수동 재기동한다.
- **`--wait-timeout` 미지원으로 preflight 실패**: 서버의 Compose가 v2.17.0 미만이다.
  `docker compose version` 확인 후 업그레이드한다. 이 단계에서 멈추면 서버 상태는 그대로다.
- **러너 오프라인**: `sudo ~/actions-runner/svc.sh status` 확인, 필요 시 `start`.
- **디스크 부족**: `docker image prune -f`는 배포 성공 시마다 실행되지만, 볼륨/빌드캐시가 쌓이면
  `docker system df`로 확인 후 `docker builder prune` 등을 수동 실행.
  (`:rollback` 태그가 붙은 직전 이미지 1개는 의도적으로 보존되므로 prune 대상이 아니다.)
