# contracts

三端（端侧 / 云端 / 家长端）共享的协议与枚举，作为实现的单一事实来源。

| 目录 | 用途 |
|------|------|
| `openapi/` | HTTP API：设备 [`openapi/device-v1-mvp.yaml`](openapi/device-v1-mvp.yaml)；家长 BFF [`openapi/parent-v1-mvp.yaml`](openapi/parent-v1-mvp.yaml) |
| `mqtt/` | MQTT topic 约定与 **AsyncAPI 片段**（[`mqtt/README.md`](mqtt/README.md)、[`mqtt/device-asyncapi-stub.yaml`](mqtt/device-asyncapi-stub.yaml)） |

与云端 **HTTP/MQTT 路径索引** 对齐演进见 [`../doc/4. 服务器端设计.md`](../doc/4. 服务器端设计.md) **§2.4**。

生成代码（可选）：在 `cloud/` 与 `apps/parent/` 中分别用 OpenAPI 工具生成 TypeScript / Dart 客户端类型。
