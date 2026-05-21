# fancy-print-cloud

云端 TypeScript 工程：**npm workspaces**，入口拆分如下。

| 应用 | 技术栈 | 默认端口 | 说明 |
|------|--------|----------|------|
| `apps/gateway` | Fastify | `3000` | 对外网关：TLS 终结、路由、限流（逻辑随迭代补充） |
| `apps/device-api` | NestJS + Fastify | `3001` | 设备 HTTPS：任务、注册、策略等 |
| `apps/parent-bff` | NestJS + Fastify | `3002` | 家长 BFF：账号强鉴权、家庭与设备视图 |

共享库放在 `packages/*`（示例：`@fancy-print/config`）。

**实现范围**：`cloud/` 侧重 **HTTP/MQTT 契约与编排骨架**；真实 ASR、文生图、图审、对象存储与家长端 **量产 OIDC** 属于设计文档 **§8** 量产交付项，当前为桩或开发换票，与 **§8.1** 说明一致（见 [`../doc/4. 服务器端设计.md`](../doc/4.%20服务器端设计.md)）。

若 `node_modules` 曾由其他包管理器生成，建议删除 `cloud/node_modules` 后重新执行 `npm install`，避免残留目录干扰。

## 前置条件

- [Node.js](https://nodejs.org/) 20+（自带 npm 9+ 即可使用 workspaces）

## 常用命令

在 **`cloud/`** 目录下执行：

```bash
npm install
npm run dev:gateway
npm run dev:device-api
npm run dev:parent-bff
npm run build
```

健康检查：`GET /health`（各服务一致）。`device-api` 业务在 **`/v1/*`**；`parent-bff` 在 **`/v1/parent/*`**；两者均暴露 **`GET /metrics`**（Prometheus 文本，`device-api` / `gateway`）。

**可观测**：各服务对请求生成或透传 **`X-Request-Id`**；若客户端提供 **`traceparent` / `tracestate`**（W3C Trace Context），**网关与各 API** 在响应中回显并 **由网关转发至上游**（与 doc/4 **§6** 追踪诉求对齐）。

### 网关路由（`gateway`）

- **`/v1/parent/*`** → `PARENT_BFF_URL`（默认 `http://127.0.0.1:3002`）  
- **`/v1/*`**（其余）→ `DEVICE_API_URL`（默认 `http://127.0.0.1:3001`）  

须 **先注册** `/v1/parent`，再注册 `/v1`，避免被设备路由吞掉。

### 设备通道（`device-api`）

**鉴权（doc/4 §5 开发桩）**

1. `POST /v1/auth/device` 或 `POST /v1/devices/sessions`，请求体 `{"device_id":"fancy-print-dev","device_secret":"fancy-print-secret"}`（或 `DEVICE_DEV_CREDENTIALS` JSON 覆盖）。  
2. 响应中的 **`access_token`** 作为后续请求的 **`Authorization: Bearer ...`**。  
3. `POST /v1/auth/token` 使用 `refresh_token` 换发。

**密钥环境变量（生产务必修改）**：`DEVICE_JWT_ACCESS_SECRET`、`DEVICE_JWT_REFRESH_SECRET`、`DEVICE_DEV_CREDENTIALS`。

**Job 主路径**

1. `POST /v1/jobs` 返回 **201**，响应头 **`Location: /v1/jobs/{id}`**；体 `{"content_mode":"…","child_profile_id":"可选"}`。`content_mode` **须为** `GET /v1/policy` 返回的 **`content_modes_allowed`** 之一（当前桩：`coloring_quiet_book`、`paper_craft`、`dress_up`）。可选 **`Idempotency-Key`**（**按设备作用域** 幂等）。  
2. `POST /v1/jobs/{id}/audio` **整段关采音**（可选 body **`audio_base64`**，在配置 **`ASR_HTTP_URL`** 时随 ASR 请求发送）；或 **`POST /v1/jobs/{id}/chunks`**：无 body / `{final:true}` 与 audio 等价；带 **`seq`+`final`** 时 `seq` 须**严格递增**（重复 `seq` 幂等），`final:true` 关采音（仍无真实分片缓冲）。  
3. 多次 **`GET /v1/jobs/{id}`** 轮询：每次 **推进一档** stub 状态机直至 `preview_ready`。  
4. **`GET /v1/jobs/{id}/artifact`** → `302` 到预览 URL（未就绪则 `409`）。  
5. `POST .../print-ack` 必须 **`Idempotency-Key`**（**按设备作用域** 幂等）。

**策略**：`GET /v1/policy` 与 `GET /v1/devices/{device_id}/policy` 支持 **`If-None-Match`** → **304**；响应带 **ETag**。

**MQTT（doc/4 §2.4.3）**：设置 **`MQTT_URL`** 后，Job 状态变更会向 `devices/{device_id}/jobs/{job_id}/status` 发布（QoS1）。另设 **`MQTT_SUBSCRIBE_TELEMETRY=1`**（`1`/`true`/`yes`）时，`device-api` 会订阅 **`devices/+/telemetry`**，与 [`../edge/cloud-connector/README.md`](../edge/cloud-connector/README.md) 中的 **MQTT 发布示例** 联调。

**遥测（§2.4.3 设备→云）**：**`POST /v1/devices/telemetry`**（Bearer）接受脱敏摘要 JSON（如 `firmware_version`、`rssi_dbm`、`uptime_sec`），成功返回 **204**；禁止 `audio`/`recording`/`transcript_raw` 等字段名。指标 **`fancy_print_device_telemetry_posts_total`**（HTTPS）、**`fancy_print_device_telemetry_mqtt_received_total`**（MQTT 订阅桩）。

**mTLS**：Ingress/Nginx 或本仓库 **`gateway` 进程内 HTTPS+mTLS**（`GATEWAY_TLS_*`、`GATEWAY_MTLS_SERIAL_MAP_JSON`），见 [`docs/ingress-mtls.md`](docs/ingress-mtls.md)。

**第三方 ASR / 文生图 / S3 预签名**：设置 **`ASR_HTTP_URL`**（可选 **`ASR_HTTP_AUTHORIZATION`**、超时 **`ASR_HTTP_TIMEOUT_MS`**）、**`IMAGE_GEN_HTTP_URL`**（可选 **`IMAGE_GEN_HTTP_AUTHORIZATION`**、**`IMAGE_GEN_HTTP_TIMEOUT_MS`**、**`IMAGE_GEN_URL_TTL_MS`**）、以及 **`S3_PREVIEW_BUCKET`** + **`AWS_REGION`** + **`S3_PREVIEW_KEY_PREFIX`** / **`S3_PREVIEW_TTL_SEC`**（AWS 默认凭证链）。**GCS** 建议在生图 HTTP 服务内签名，响应 **`image_url`** 即可。详见 [`../contracts/openapi/device-v1-mvp.yaml`](../contracts/openapi/device-v1-mvp.yaml)。

**mTLS 换 JWT**：`device-api` 设 **`MTLS_HEADER_TRUST=1`**、**`TRUSTED_PROXY_IPS`**、**`MTLS_ALLOWED_DEVICE_IDS_JSON`** 或 **`MTLS_TRUST_REGISTERED_DEVICES=1`**；设备经网关带 **`x-device-id-from-mtls`** 调用 **`POST /v1/auth/mtls`**。

### 家长 BFF（`parent-bff`）

**开发换票（非量产 OIDC）**

1. `POST /v1/parent/auth/login`，体 `{"email":"you@example.com","password":"…"}`，密码默认与 **`PARENT_DEV_PASSWORD`**（默认 `dev`）一致。  
2. 使用返回的 **`access_token`** 访问 `GET /v1/parent/me` 及 **`/v1/parent/households/{id}/...`** 各路由（当前为占位 JSON）。路径中的 **`household_id` 须与 JWT 内默认家庭一致**，否则 **403**。  
3. `POST /v1/parent/households/{id}/devices/bind`、`.../jobs/{job_id}/approve`、`.../reject` 须带 **`Idempotency-Key`**（内存幂等回放）。  
4. `POST /v1/parent/auth/token` 刷新。

环境变量：`PARENT_JWT_ACCESS_SECRET`、`PARENT_JWT_REFRESH_SECRET`、`PARENT_DEV_PASSWORD`、`PARENT_DEV_HOUSEHOLD_ID`。

HTTP 契约见仓库根 [`../contracts/`](../contracts/)（[`openapi/device-v1-mvp.yaml`](../contracts/openapi/device-v1-mvp.yaml)、[`openapi/parent-v1-mvp.yaml`](../contracts/openapi/parent-v1-mvp.yaml)、[`mqtt/README.md`](../contracts/mqtt/README.md)）。
