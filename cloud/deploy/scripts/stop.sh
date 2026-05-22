#!/usr/bin/env bash
# 停止并移除 Compose 栈（默认全栈项目名 fancy-print）。
#
# 用法：
#   ./cloud/deploy/scripts/stop.sh
#   ./cloud/deploy/scripts/stop.sh --device-only
#   ./cloud/deploy/scripts/stop.sh --volumes   # 同时删除 Redis 卷（数据清空）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/common.sh"

MODE="stack"
WITH_VOLUMES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-only) MODE="device" ;;
    --volumes) WITH_VOLUMES=1 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

fp_require_cmd docker

down_args=(down --remove-orphans)
[[ "${WITH_VOLUMES}" -eq 1 ]] && down_args+=(--volumes)

if [[ "${MODE}" == "device" ]]; then
  fp_compose -f "${FP_COMPOSE_DEVICE_API}" "${down_args[@]}"
else
  if [[ -f "${FP_ENV_STACK}" ]]; then
    fp_compose -f "${FP_COMPOSE_STACK}" --env-file "${FP_ENV_STACK}" "${down_args[@]}"
  else
    fp_compose -f "${FP_COMPOSE_STACK}" "${down_args[@]}"
  fi
fi

echo "==> 已停止（项目: ${FP_PROJECT}）"
