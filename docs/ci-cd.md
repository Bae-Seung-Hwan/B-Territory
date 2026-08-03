# CI/CD — develop 자동 배포 (EC2 self-hosted 러너)

`develop`에 백엔드 관련 변경이 push되면 `.github/workflows/deploy.yml`이 EC2에서 프로덕션
스택을 재빌드·재기동한다. **EC2 안에 설치한 self-hosted 러너**가 GitHub로 아웃바운드 폴링만
하므로, 보안그룹의 `22=관리자 IP만` 규칙을 완화하지 않아도 된다(인바운드 SSH 개방 불필요).

## 배포 흐름 (workflow가 하는 일)

1. `DEPLOY_DIR`(`/home/ubuntu/B-Territory`)에서 `git fetch` + `git reset --hard origin/develop`
   — 서버 클론을 develop과 정확히 일치시킨다(`.env`·`data/` 등 gitignore 대상은 보존).
2. `docker compose ... build` — 백엔드 이미지 빌드.
3. `docker compose ... run --rm backend npm run migration:run` — **앱 기동 전에** 마이그레이션.
   일회성 컨테이너라 최초 배포(빈 DB)에서도 앱 부팅 시딩에 걸리지 않고 테이블을 먼저 만든다.
4. `docker compose ... up -d --remove-orphans` — backend + caddy 기동(postgres/redis 포함).
5. `docker image prune -f` — 이전 빌드 레이어 정리(EBS 절약).

트리거: `develop` push 중 `backend/**`·`docker-compose.prod.yml`·`Caddyfile`·`data/**`·워크플로
파일 변경 시. 수동 실행은 GitHub Actions 탭의 **Run workflow**(workflow_dispatch).

## EC2 최초 1회 — 러너 설치

전제: `DEPLOY_DIR`에 레포가 clone돼 있고 `backend/.env`가 채워져 있으며, 최소 1회 수동 배포가
성공한 상태(= docker/compose 동작 확인). `ubuntu` 사용자가 `docker`를 sudo 없이 실행 가능해야
한다(`sudo usermod -aG docker ubuntu` 후 재로그인).

1. GitHub 레포 → **Settings → Actions → Runners → New self-hosted runner** → Linux/x64 선택.
   화면에 나오는 `download`/`config.sh` 명령을 **그대로 복붙**해 실행한다(토큰 포함).

   ```bash
   # 예시(실제 URL/토큰은 GitHub 화면 값으로)
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-linux-x64.tar.gz -L <GitHub가_준_URL>
   tar xzf actions-runner-linux-x64.tar.gz
   ./config.sh --url https://github.com/<owner>/<repo> --token <GitHub가_준_토큰>
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

## 적용 순서 (중요)

`deploy.yml`은 **develop에 있어야** 트리거된다. 이 브랜치(`feature/Bae/cd-auto-deploy`)를
develop에 merge한 뒤부터 자동 배포가 동작한다. merge 후 첫 배포는 GitHub Actions 탭에서
**Run workflow**로 수동 트리거해 한 번 검증하는 것을 권장한다.

## 롤백 / 트러블슈팅

- **특정 커밋으로 롤백**: 서버에서 `cd $DEPLOY_DIR && git reset --hard <sha> && docker compose
  --env-file backend/.env -f docker-compose.prod.yml up -d --build`. (다음 develop push가 다시
  최신으로 덮으므로, 필요하면 문제 커밋을 develop에서 revert하는 게 근본 해결.)
- **마이그레이션 실패로 배포 중단**: 워크플로가 3단계에서 멈춘다(앱은 기존 버전 그대로 유지 —
  아직 `up`을 안 했으므로 무중단). 마이그레이션을 고쳐 다시 push한다.
- **러너 오프라인**: `sudo ~/actions-runner/svc.sh status` 확인, 필요 시 `start`.
- **디스크 부족**: `docker image prune -f`는 매 배포 실행되지만, 볼륨/빌드캐시가 쌓이면
  `docker system df`로 확인 후 `docker builder prune` 등을 수동 실행.
