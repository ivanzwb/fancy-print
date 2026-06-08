#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# start.sh — 启动所有服务（云端 + 端侧）
# 用法: ./scripts/start.sh
# ==============================================================

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD_DIR="$PROJECT_ROOT/cloud"
ANDROID_DIR="$PROJECT_ROOT/edge/android"
ADB="$PROJECT_ROOT/.android-sdk/platform-tools/adb"
ANDROID_SERIAL="${ANDROID_SERIAL:-d3402cab93a4aec6}"
DEVICE_API_LOG="/tmp/device-api.log"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"

echo "========================================"
echo " fancy-print — 启动所有服务"
echo "========================================"

# ── 1. 启动 Mosquitto ──────────────────────────────────────────
echo ""
echo "[1/7] Starting Mosquitto..."
if pgrep -f mosquitto > /dev/null 2>&1; then
  echo "  ✓ Mosquitto already running"
else
  brew services start mosquitto
  sleep 2
  echo "  ✓ Mosquitto started"
fi

# ── 2. 启动 Redis ──────────────────────────────────────────────
echo ""
echo "[2/7] Starting Redis..."
if redis-cli ping > /dev/null 2>&1; then
  echo "  ✓ Redis already running (PONG)"
else
  brew services start redis
  sleep 1
  echo "  ✓ Redis started"
fi

# ── 3. 构建 device-api ─────────────────────────────────────────
echo ""
echo "[3/7] Building device-api..."
# 清除 tsbuildinfo（incremental 模式下删除 dist/ 后 tsbuildinfo 会使 tsc 跳过编译）
rm -f "$CLOUD_DIR/apps/device-api/"*.tsbuildinfo "$CLOUD_DIR/apps/device-api/tsconfig.build.tsbuildinfo"
cd "$CLOUD_DIR"
npm run build -w device-api
echo "  ✓ device-api built"

# ── 4. 启动 device-api ─────────────────────────────────────────
echo ""
echo "[4/7] Starting device-api..."
if lsof -ti :3001 > /dev/null 2>&1; then
  echo "  ⚠ Port 3001 already in use — restarting"
  kill -9 "$(lsof -ti :3001)" 2>/dev/null || true
  sleep 1
fi
cd "$CLOUD_DIR/apps/device-api"
nohup node dist/main.js >> "$DEVICE_API_LOG" 2>&1 &
DEVICE_API_PID=$!
echo "  ✓ device-api started (PID $DEVICE_API_PID, log: $DEVICE_API_LOG)"

# Wait for health check
for i in $(seq 1 10); do
  if curl -s http://127.0.0.1:3001/health > /dev/null 2>&1; then
    echo "  ✓ device-api health check passed"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "  ✗ device-api health check FAILED — check $DEVICE_API_LOG"
  fi
  sleep 1
done

# ── 5. 构建 Android APK ────────────────────────────────────────
echo ""
echo "[5/7] Building Android APK..."
export JAVA_HOME
cd "$ANDROID_DIR"
./gradlew assembleDebug
echo "  ✓ Android APK built"

# ── 6. 安装 APK 到设备 ─────────────────────────────────────────
echo ""
echo "[6/7] Installing APK on device..."
"$ADB" -s "$ANDROID_SERIAL" install -r "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
echo "  ✓ APK installed"

# ── 7. 设置 ADB reverse proxy ──────────────────────────────────
echo ""
echo "[7/7] Setting up ADB reverse proxies..."
"$ADB" -s "$ANDROID_SERIAL" reverse tcp:1883 tcp:1883
"$ADB" -s "$ANDROID_SERIAL" reverse tcp:3001 tcp:3001
echo "  ✓ ADB reverse proxies set (1883→MQTT, 3001→device-api)"

echo ""
echo "========================================"
echo " All services started successfully!"
echo "========================================"
echo ""
echo "  Mosquitto   : 1883"
echo "  Redis       : 6379"
echo "  device-api  : 3001  (log: $DEVICE_API_LOG)"
echo "  Device      : $ANDROID_SERIAL"
echo ""
echo "  Stop all: ./scripts/stop.sh"
echo "========================================"
