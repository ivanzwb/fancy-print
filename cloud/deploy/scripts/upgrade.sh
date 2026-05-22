#!/usr/bin/env bash
# 重新构建并滚动替换容器（无镜像仓库时的单机更新）。
#
# 用法（在已 clone 的仓库目录）：
#   ./cloud/deploy/scripts/upgrade.sh
#   ./cloud/deploy/scripts/upgrade.sh --device-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/deploy.sh" ${1+"$@"}
