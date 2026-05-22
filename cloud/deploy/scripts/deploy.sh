#!/usr/bin/env bash
# 一键部署（全栈 Compose）：构建镜像并后台启动。
#
# 用法：
#   ./cloud/deploy/scripts/deploy.sh              # 全栈（需 stack.env）
#   ./cloud/deploy/scripts/deploy.sh --device-only # 仅 Redis + device-api + worker（演示）
#   ./cloud/deploy/scripts/deploy.sh --pull       # git pull 后再部署（需在 git 仓库内）
#
# 环境变量：
#   FP_PROJECT          Compose 项目名（默认 fancy-print）
#   FP_ENV_STACK        全栈 env 文件路径（默认 cloud/deploy/env/stack.env）
#   FP_COMPOSE_STACK    全栈 compose 文件
#
# 依赖：Docker 24+、docker compose v2、bash；建议在 Linux 服务器或 WSL2 执行。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/common.sh"

DO_PULL=0
MODE="stack"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-only) MODE="device" ;;
    --pull) DO_PULL=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

fp_require_cmd docker
docker compose version >/dev/null 2>&1 || {
  echo "error: 需要 Docker Compose v2（docker compose）" >&2
  exit 1
}

if [[ "${DO_PULL}" -eq 1 ]]; then
  fp_require_cmd git
  git -C "${FP_REPO_ROOT}" pull --ff-only
fi

if [[ "${MODE}" == "device" ]]; then
  echo "==> 部署模式: device-api（Redis + API + pipeline worker）"
  fp_compose -f "${FP_COMPOSE_DEVICE_API}" up -d --build
  echo "==> device-api: http://127.0.0.1:3001/health"
  exit 0
fi

echo "==> 部署模式: 全栈（gateway + device-api + parent-bff + Redis + worker）"

if [[ ! -f "${FP_ENV_STACK}" ]]; then
  if [[ -f "${FP_ENV_EXAMPLE}" ]]; then
    echo "warn: 未找到 ${FP_ENV_STACK}，从模板复制（请务必修改密钥！）"
    cp "${FP_ENV_EXAMPLE}" "${FP_ENV_STACK}"
  else
    echo "error: 缺少 env 文件: ${FP_ENV_STACK}" >&2
    exit 1
  fi
fi

fp_compose -f "${FP_COMPOSE_STACK}" --env-file "${FP_ENV_STACK}" up -d --build

echo "==> gateway:  http://127.0.0.1:3000/health"
echo "==> device-api: http://127.0.0.1:3001/health"
echo "==> parent-bff: http://127.0.0.1:3002/health"
echo "==> 查看日志: ${SCRIPT_DIR}/logs.sh"
