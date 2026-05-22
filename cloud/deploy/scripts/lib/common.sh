#!/usr/bin/env bash
# shellcheck shell=bash
# 供 cloud/deploy/scripts/*.sh source；定位仓库根目录与默认路径。

fp_deploy_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # lib -> scripts -> deploy -> cloud -> repo（四级）
  (cd "${here}/../../../.." && pwd)
}

FP_REPO_ROOT="$(fp_deploy_root)"
FP_COMPOSE_STACK="${FP_COMPOSE_STACK:-${FP_REPO_ROOT}/cloud/deploy/compose/docker-compose.stack.yml}"
FP_COMPOSE_DEVICE_API="${FP_COMPOSE_DEVICE_API:-${FP_REPO_ROOT}/cloud/deploy/compose/docker-compose.device-api.yml}"
FP_ENV_STACK="${FP_ENV_STACK:-${FP_REPO_ROOT}/cloud/deploy/env/stack.env}"
FP_ENV_EXAMPLE="${FP_ENV_EXAMPLE:-${FP_REPO_ROOT}/cloud/deploy/env/stack.example.env}"
FP_PROJECT="${FP_PROJECT:-fancy-print}"

fp_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: 需要安装命令: $1" >&2
    exit 1
  }
}

fp_compose() {
  docker compose --project-name "${FP_PROJECT}" "$@"
}
