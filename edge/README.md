# 端侧软件（整机）

与 [`doc/3. 端侧设计.md`](../doc/3. 端侧设计.md) 中的进程划分对齐；实现语言与构建系统（Yocto / Buildroot / CMake 等）在子目录落地时补充。

| 目录 | 组件 |
|------|------|
| `fancy-print-ui/` | 儿童触屏 UI |
| `edge-daemon/` | 打印、音频、缓存、GPIO；IPC 服务端 |
| `cloud-connector/` | HTTPS / MQTT、令牌与重试 |
| `ota-agent/` | 签名校验、系统与应用 OTA |
