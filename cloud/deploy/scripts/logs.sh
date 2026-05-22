#!/usr/bin/env bash
# 跟踪服务日志（Ctrl+C 退出）。
#
# 用法：
#   ./cloud/deploy/scripts/logs.sh
#   ./cloud/deploy/scripts/logs.sh gateway device-api
#   ./cloud/deploy/scripts/logs.sh --device-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/common.sh"

fp_require_cmd docker

MODE="stack"
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-only) MODE="device" ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

if [[ "${MODE}" == "device" ]]; then
  fp_compose -f "${FP_COMPOSE_DEVICE_API}" logs -f "${ARGS[@]}"
else
  if [[ -f "${FP_ENV_STACK}" ]]; then
    fp_compose -f "${FP_COMPOSE_STACK}" --env-file "${FP_ENV_STACK}" logs -f "${ARGS[@]}"
  else
    fp_compose -f "${FP_COMPOSE_STACK}" logs -f "${ARGS[@]}"
  fi
fi
