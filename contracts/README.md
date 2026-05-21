# contracts

三端（端侧 / 云端 / 家长端）共享的协议与枚举，作为实现的单一事实来源。

| 目录 | 用途 |
|------|------|
| `openapi/` | HTTP API（设备通道、家长 BFF）的 OpenAPI 描述或片段 |
| `mqtt/` | MQTT topic 约定、消息 JSON Schema（若启用） |

生成代码（可选）：在 `cloud/` 与 `apps/parent/` 中分别用 OpenAPI 工具生成 TypeScript / Dart 客户端类型。
