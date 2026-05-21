# cloud-connector（设备侧云上客户端）

与 [`doc/4. 服务器端设计.md`](../../doc/4.%20服务器端设计.md) **§2.4**、**§5** 一致：量产由端侧进程负责 **HTTPS**（任务/策略/artifact）与可选 **MQTT**（遥测、任务状态订阅等）。本目录当前提供 **可运行的 MQTT 发布示例**，便于与云端 **`MQTT_SUBSCRIBE_TELEMETRY`** 联调。

## 发布遥测（真实 MQTT 客户端）

1. 启动本地 Broker（如 Mosquitto）并设置 **`MQTT_URL`**（与 `device-api` 的 **`MQTT_URL`** 指向同一 Broker）。
2. 在 `device-api` 开启订阅桩：`MQTT_SUBSCRIBE_TELEMETRY=1`（与 **`MQTT_URL`** 同时设置）。
3. 在本目录执行：

```bash
npm install
set MQTT_URL=mqtt://127.0.0.1:1883
set DEVICE_ID=fancy-print-dev
npm run telemetry:publish
```

可选环境变量：`FIRMWARE_VERSION`、`RSSI_DBM`、`UPTIME_SEC`。

云端会计数 **`fancy_print_device_telemetry_mqtt_received_total`**，并在日志中出现 `telemetry_mqtt`。

## HTTPS 遥测兜底

若现场 **仅 HTTPS**，可使用 **`POST /v1/devices/telemetry`**（见 [`contracts/openapi/device-v1-mvp.yaml`](../../contracts/openapi/device-v1-mvp.yaml)），与 MQTT **语义并列**，非重复业务逻辑。

## 量产集成（未在本仓库实现）

- **ASR / 生图 / 对象存储**：见 `cloud/apps/device-api` 内 **`VendorStubsService`** 替换为供应商 Adapter（doc/4 **§8.1**）。
- **mTLS**：见 [`cloud/docs/ingress-mtls.md`](../../cloud/docs/ingress-mtls.md)。
