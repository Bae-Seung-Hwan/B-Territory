#!/usr/bin/env bash
#
# WSL에서 backend e2e를 실행한다.
#
# 왜 필요한가:
#   개발 인프라(Postgres·Redis)가 WSL에 네이티브로 설치돼 있고 둘 다 WSL 내부
#   127.0.0.1에만 바인딩돼 있어, Windows 쪽 node로는 접속이 안 된다
#   (globalSetup이 Redis 연결에서 실패). 그렇다고 /mnt/c의 node_modules를
#   WSL에서 그대로 쓸 수도 없다 — bcrypt 같은 네이티브 모듈이 Windows 바이너리다.
#   그래서 소스를 WSL 네이티브 FS로 복사해 Linux용 npm ci를 따로 유지한다.
#
# 사전 준비 (1회):
#   WSL에 Node 설치. sudo 없이 nvm으로 충분하다.
#     curl -fsSL -o /tmp/nvm.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh
#     bash /tmp/nvm.sh && . "$HOME/.nvm/nvm.sh" && nvm install 24
#
# 사용법 (Windows PowerShell에서):
#   wsl -e bash scripts/run-e2e-wsl.sh              # 전체 e2e
#   wsl -e bash scripts/run-e2e-wsl.sh missions     # 특정 스펙만
#
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$SCRIPT_DIR")

# 작업 사본 위치. WSL 네이티브 FS여야 한다(/mnt/c에 두면 npm ci가 매우 느리다).
WORK="${E2E_WORK_DIR:-$HOME/bt-e2e}"
DST="$WORK/backend"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 24 >/dev/null
fi

if ! command -v node >/dev/null; then
  echo "WSL에 node가 없다. 위 '사전 준비'의 nvm 설치를 먼저 실행할 것." >&2
  exit 1
fi

# DistrictsService가 cwd 기준 ../data/busan_districts.csv를 읽으므로
# backend와 data를 리포지토리와 같은 형제 구조로 둔다.
mkdir -p "$DST" "$WORK/data"
echo "== 소스 동기화 =="
# tar는 덮어쓰기만 하고 삭제하지 않는다. 브랜치를 바꾸면 이전 브랜치에만 있던 파일이
# 사본에 남아, 지금 브랜치에 존재하지도 않는 스펙이 실패한다(의존성이 없거나 라우트가
# 없어서). 실제 코드 문제로 착각하기 쉬우므로 node_modules만 남기고 비운 뒤 푼다.
find "$DST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
find "$WORK/data" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -C "$REPO/backend" \
  --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude='*.tsbuildinfo' \
  -cf - . | tar -C "$DST" -xf -
tar -C "$REPO/data" -cf - . | tar -C "$WORK/data" -xf -

cd "$DST"
# package-lock이 바뀌었으면 다시 설치한다.
if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.e2e-lock; then
  echo "== npm ci (Linux 네이티브) =="
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.e2e-lock
fi

echo "== e2e 실행 =="
# --forceExit: 앱이 남긴 핸들(ioredis 등)로 jest가 안 끝나는 것을 방지
npx jest --config ./test/jest-e2e.json --forceExit "$@"
