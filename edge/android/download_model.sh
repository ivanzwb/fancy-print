#!/bin/bash
# download_model.sh — 下载 Sherpa-ONNX 中文 ASR 模型到 Android assets
#
# 模型：sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
#       中文专有 Zipformer，~14MB，适合儿童语音场景
# 用法：在 edge/android/ 目录下运行：bash download_model.sh

set -euo pipefail

MODEL_NAME="sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
ASSETS_DIR="app/src/main/assets"
TARGET_DIR="${ASSETS_DIR}/${MODEL_NAME}"

echo "=== 奇想印印 Sherpa-ONNX 模型下载 ==="
echo "模型: ${MODEL_NAME}"
echo "目标: ${TARGET_DIR}"
echo ""

# 检查目标目录是否已存在完整模型
if [ -d "${TARGET_DIR}" ]; then
    REQUIRED_FILES=("encoder-epoch-99-avg-1.onnx" "decoder-epoch-99-avg-1.onnx" "joiner-epoch-99-avg-1.onnx" "tokens.txt")
    ALL_EXIST=true
    for f in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "${TARGET_DIR}/${f}" ]; then
            ALL_EXIST=false
            break
        fi
    done
    if $ALL_EXIST; then
        echo "模型文件已存在，跳过下载。"
        echo "如需重新下载，请先删除: rm -rf ${TARGET_DIR}"
        exit 0
    fi
fi

# 创建临时下载目录
TMP_DIR=$(mktemp -d)
trap 'rm -rf ${TMP_DIR}' EXIT

echo "下载模型从: ${MODEL_URL}"
if command -v curl &> /dev/null; then
    curl -L -o "${TMP_DIR}/${MODEL_NAME}.tar.bz2" "${MODEL_URL}"
elif command -v wget &> /dev/null; then
    wget -O "${TMP_DIR}/${MODEL_NAME}.tar.bz2" "${MODEL_URL}"
else
    echo "错误: 需要 curl 或 wget"
    exit 1
fi

echo "解压模型..."
mkdir -p "${TMP_DIR}/extracted"
tar xvf "${TMP_DIR}/${MODEL_NAME}.tar.bz2" -C "${TMP_DIR}/extracted"

# 复制到 assets 目录
mkdir -p "${TARGET_DIR}"
cp -v "${TMP_DIR}/extracted/${MODEL_NAME}/"*.onnx "${TARGET_DIR}/"
cp -v "${TMP_DIR}/extracted/${MODEL_NAME}/tokens.txt" "${TARGET_DIR}/"

echo ""
echo "=== 模型下载完成 ==="
echo "文件列表:"
ls -lh "${TARGET_DIR}/"
echo ""
echo "总计大小: $(du -sh "${TARGET_DIR}" | cut -f1)"
echo ""
echo "现在可以构建 APK: ./gradlew assembleDebug"
