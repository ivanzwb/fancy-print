# MQTT 契约索引（与 doc/4 §2.4.3、§3.2 对齐）

实现与载荷字段以 **AsyncAPI / JSON Schema** 为准逐步补全；以下为 **Topic 与方向** 单一事实来源索引。

## 云 → 设备

| Topic 模式 | QoS 建议 | 载荷要点 |
|------------|----------|----------|
| `devices/{device_id}/jobs/{job_id}/status` | 1 | `state`, `preview_url`, **`preview_url_ttl`**（**剩余秒数**，整数或 `null`）、`preview_url_expires_at`（ISO8601 或 `null`）、`transcript`、`chunks_max_seq`（分片桩进度或 `null`）、`error_code`, `policy_version` |
| `devices/{device_id}/policy` | 1 | `version`, `hash`, `apply_after`, `body`（可选内嵌策略摘要） |

## 设备 → 云

| Topic 模式 | QoS 建议 | 载荷要点 |
|------------|----------|----------|
| `devices/{device_id}/telemetry` | 0 或 1 | 固件版本、信号、**脱敏** 心跳（**禁止**儿音原文） |

与 MQTT 并列（或仅 HTTPS 时兜底）：`device-api` 提供 **`POST /v1/devices/telemetry`**（需设备 Bearer），语义对齐上表「脱敏摘要」；Prometheus 计数器 **`fancy_print_device_telemetry_posts_total`**（`result=accepted|rejected`）。详见 [`../openapi/device-v1-mvp.yaml`](../openapi/device-v1-mvp.yaml)。

另：**`MQTT_URL` + `MQTT_SUBSCRIBE_TELEMETRY=1`** 时，`device-api` **订阅** `devices/+/telemetry`，计数 **`fancy_print_device_telemetry_mqtt_received_total`**；设备侧真实发布示例见 [`../edge/cloud-connector/README.md`](../edge/cloud-connector/README.md)。

`device-api` 在设置环境变量 **`MQTT_URL`** 时，会在 Job 状态变更时向 `devices/.../jobs/.../status` **发布**（见 `cloud/apps/device-api/src/mqtt/mqtt.service.ts`）。
