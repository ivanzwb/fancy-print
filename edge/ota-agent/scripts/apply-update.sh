#!/bin/bash
# apply-update.sh — 应用 OTA 更新包
# Usage: apply-update.sh <package_path> <current_version>
#
# 插入到 /usr/lib/fancy-print/scripts/apply-update.sh 由 ota-agent 调用。
# 开发环境使用此存档下的脚本。

PACKAGE="$1"
VERSION="$2"

if [ -z "$PACKAGE" ] || [ -z "$VERSION" ]; then
    echo "Usage: $0 <package_path> <current_version>"
    exit 1
fi

echo "Applying update: version=$VERSION package=$PACKAGE"
# TODO: 解包 -> 校验 -> 安装固件/应用
echo "Update applied successfully (stub)"
