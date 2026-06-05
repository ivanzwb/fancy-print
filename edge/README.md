# 端侧软件（整机）

与 [`doc/3. 端侧设计.md`](../doc/3. 端侧设计.md) 中的进程划分对齐；实现语言与构建系统（Yocto / Buildroot / CMake 等）在子目录落地时补充。

## 平台目录

| 平台 | 目录 | 说明 |
|------|------|------|
| **Debian**（量产主线） | `debian/` | Go edge-daemon + React Web UI kiosk |
| **Android**（技术备案） | `android/` | Java/Kotlin 原生应用（SDK 34） |

## 跨平台组件

| 目录 | 组件 |
|------|------|
| `cloud-connector/` | HTTPS / MQTT、令牌与重试 |
| `ota-agent/` | 签名校验、系统与应用 OTA |

## 平台内部目录

### `debian/`

| 目录 | 组件 |
|------|------|
| `edge-daemon/` | Go 守护进程：打印、音频、GPIO、IPC（gRPC 服务端） |
| `fancy-print-ui/` | React + Vite 儿童触屏 UI（Web kiosk） |
