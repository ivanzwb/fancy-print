# MQTT 契约索引（与 doc/4 §2.4.3、§3.2 对齐）

实现与载荷字段以 **AsyncAPI / JSON Schema** 为准逐步补全；以下为 **Topic 与方向** 单一事实来源索引。

## 云 → 设备

| Topic 模式 | QoS 建议 | 载荷要点 |
|------------|----------|----------|
| `devices/{device_id}/jobs/{job_id}/status` | 1 | `state`, `preview_url`, `preview_url_ttl`, `error_code`, `policy_version` |
| `devices/{device_id}/policy` | 1 | `version`, `hash`, `apply_after`, `body`（可选内嵌策略摘要） |

## 设备 → 云

| Topic 模式 | QoS 建议 | 载荷要点 |
|------------|----------|----------|
| `devices/{device_id}/telemetry` | 0 或 1 | 固件版本、信号、**脱敏** 心跳（**禁止**儿音原文） |

`device-api` 在设置环境变量 **`MQTT_URL`** 时，会在 Job 状态变更时向 `devices/.../jobs/.../status` **发布**（见 `cloud/apps/device-api/src/mqtt/mqtt.service.ts`）。
