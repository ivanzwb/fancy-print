#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# stop.sh — 停止所有服务
# 用法: ./scripts/stop.sh
# ==============================================================

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$PROJECT_ROOT/.android-sdk/platform-tools/adb"
ANDROID_SERIAL="${ANDROID_SERIAL:-d3402cab93a4aec6}"

echo "========================================"
echo " fancy-print — 停止所有服务"
echo "========================================"

# ── 1. 停止 device-api ─────────────────────────────────────────
echo ""
echo "[1/4] Stopping device-api..."
if lsof -ti :3001 > /dev/null 2>&1; then
  kill -9 "$(lsof -ti :3001)" 2>/dev/null || true
  echo "  ✓ device-api stopped"
else
  echo "  — device-api not running"
fi

# ── 2. 停止 Mosquitto ──────────────────────────────────────────
echo ""
echo "[2/4] Stopping Mosquitto..."
if pgrep -f mosquitto > /dev/null 2>&1; then
  brew services stop mosquitto
  echo "  ✓ Mosquitto stopped"
else
  echo "  — Mosquitto not running"
fi

# ── 3. 停止 Redis ──────────────────────────────────────────────
echo ""
echo "[3/4] Stopping Redis..."
if redis-cli ping > /dev/null 2>&1; then
  brew services stop redis
  echo "  ✓ Redis stopped"
else
  echo "  — Redis not running"
fi

# ── 4. 移除 ADB reverse proxy ──────────────────────────────────
echo ""
echo "[4/4] Removing ADB reverse proxies..."
if "$ADB" -s "$ANDROID_SERIAL" reverse --list 2>/dev/null | grep -q .; then
  "$ADB" -s "$ANDROID_SERIAL" reverse --remove tcp:1883 2>/dev/null || true
  "$ADB" -s "$ANDROID_SERIAL" reverse --remove tcp:3001 2>/dev/null || true
  echo "  ✓ ADB reverse proxies removed"
else
  echo "  — No ADB reverse proxies"
fi

echo ""
echo "========================================"
echo " All services stopped."
echo "========================================"
