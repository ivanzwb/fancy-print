#!/usr/bin/env bash
# 检查本机对外 HTTP 健康端点（需在栈已启动的机器上执行）。
#
# 用法：
#   ./cloud/deploy/scripts/healthcheck.sh
#   GATEWAY_URL=http://10.0.0.5:3000 ./cloud/deploy/scripts/healthcheck.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/common.sh"

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:3000}"
DEVICE_URL="${DEVICE_URL:-http://127.0.0.1:3001}"
PARENT_URL="${PARENT_URL:-http://127.0.0.1:3002}"
CHECK_GATEWAY="${CHECK_GATEWAY:-1}"
CHECK_DIRECT="${CHECK_DIRECT:-1}"

fp_require_cmd curl

check_one() {
  local name="$1" url="$2"
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "${url}/health" || true)"
  if [[ "${code}" == "200" ]]; then
    echo "ok  ${name} ${url}/health"
  else
    echo "bad ${name} ${url}/health (http ${code})" >&2
    return 1
  fi
}

fail=0
if [[ "${CHECK_GATEWAY}" == "1" ]]; then
  check_one "gateway" "${GATEWAY_URL}" || fail=1
fi
if [[ "${CHECK_DIRECT}" == "1" ]]; then
  check_one "device-api" "${DEVICE_URL}" || fail=1
  check_one "parent-bff" "${PARENT_URL}" || fail=1
fi

exit "${fail}"
