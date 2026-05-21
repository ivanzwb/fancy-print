# fancy-print-cloud

云端 TypeScript 工程：**npm workspaces**，入口拆分如下。

| 应用 | 技术栈 | 默认端口 | 说明 |
|------|--------|----------|------|
| `apps/gateway` | Fastify | `3000` | 对外网关：TLS 终结、路由、限流（逻辑随迭代补充） |
| `apps/device-api` | NestJS + Fastify | `3001` | 设备 HTTPS：任务、注册、策略等 |
| `apps/parent-bff` | NestJS + Fastify | `3002` | 家长 BFF：账号强鉴权、家庭与设备视图 |

共享库放在 `packages/*`（示例：`@fancy-print/config`）。

**实现范围**：`cloud/` 侧重 **HTTP/MQTT 契约与编排骨架**；ASR / 文生图为 **进程内 Adapter**（讯飞、通义，见 [`doc/4. 服务器端设计.md`](../doc/4.%20服务器端设计.md) **§2.2.2**）；图审与家长端 **量产 OIDC** 等仍属设计文档 **§8** 量产交付项，与 **§8.1** 说明一致（同文档）。

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

**密钥环境变量（生产务必修改）**：`DEVICE_JWT_ACCESS_SECRET`、`DEVICE_JWT_REFRESH_SECRET`、`DEVICE_DEV_CREDENTIALS`；可选 **`DEVICE_REGISTRY_JSON_PATH`**（JSON 文件合并更多 `device_id` / `secret`）。

**Job 主路径**

1. `POST /v1/jobs` 返回 **201**，响应头 **`Location: /v1/jobs/{id}`**；体 `{"content_mode":"…","child_profile_id":"可选"}`。`content_mode` **须为** `GET /v1/policy` 返回的 **`content_modes_allowed`** 之一（当前桩：`coloring_quiet_book`、`paper_craft`、`dress_up`）。可选 **`Idempotency-Key`**（**按设备作用域** 幂等）。  
2. `POST /v1/jobs/{id}/audio` **整段关采音**（可选 body **`audio_base64`**）；关采音后由 **`ASR_DRIVER`** 选定的 **进程内 ASR**（默认 `auto`：已配讯飞凭据则 **IAT**，否则桩转写）。可选 **`S3_AUDIO_BUCKET`** 时先生成预签名 URL 供 ASR 拉取。或 **`POST /v1/jobs/{id}/chunks`**：无 body / `{final:true}` 与 audio 等价；带 **`seq`+`final`** 时 `seq` 须**严格递增**（重复 `seq` 幂等），每片可选 **`audio_base64`**，`final:true` 时按序号**解码拼接**为整段再关采音。  
3. 多次 **`GET /v1/jobs/{id}`** 轮询：每次 **推进一档**（ASR → 文本审核 → 生图与成图审核 → 预览）；审核未配置 HTTP 时该步默认放行；上游失败则 **`state: failed`** 与 **`error_code`**。多实例请配置 **`REDIS_URL`**（Job 与幂等键存 Redis）；单机可用 **`JOBS_PERSISTENCE_PATH`** 落盘 JSON（与 Redis 二选一，见 README）。  
4. **`GET /v1/jobs/{id}/artifact`** → `302` 到预览 URL（未就绪则 `409`）。  
5. `POST .../print-ack` 必须 **`Idempotency-Key`**（**按设备作用域** 幂等）。

**策略**：`GET /v1/policy` 与 `GET /v1/devices/{device_id}/policy` 支持 **`If-None-Match`** → **304**；响应带 **ETag**。

**MQTT（doc/4 §2.4.3）**：设置 **`MQTT_URL`** 后，Job 状态变更会向 `devices/{device_id}/jobs/{job_id}/status` 发布（QoS1）。另设 **`MQTT_SUBSCRIBE_TELEMETRY=1`**（`1`/`true`/`yes`）时，`device-api` 会订阅 **`devices/+/telemetry`**，与 [`../edge/cloud-connector/README.md`](../edge/cloud-connector/README.md) 中的 **MQTT 发布示例** 联调。

**遥测（§2.4.3 设备→云）**：**`POST /v1/devices/telemetry`**（Bearer）接受脱敏摘要 JSON（如 `firmware_version`、`rssi_dbm`、`uptime_sec`），成功返回 **204**；禁止 `audio`/`recording`/`transcript_raw` 等字段名。指标 **`fancy_print_device_telemetry_posts_total`**（HTTPS）、**`fancy_print_device_telemetry_mqtt_received_total`**（MQTT 订阅桩）。可选 **`DEVICE_TELEMETRY_LOG_PATH`**：每行一条 **NDJSON** 审计（仅已接受的摘要字段）。

**mTLS**：Ingress/Nginx 或本仓库 **`gateway` 进程内 HTTPS+mTLS**（`GATEWAY_TLS_*`、`GATEWAY_MTLS_SERIAL_MAP_JSON`），见 [`docs/ingress-mtls.md`](docs/ingress-mtls.md)。

**供应商 Adapter**：**`ASR_DRIVER`**（`auto`|`iflytek`|`stub`）与 **`IMAGE_GEN_DRIVER`**（`auto`|`tongyi`|`stub`）选择进程内 **讯飞 IAT**、**通义万相（DashScope）** 或桩；环境变量与扩展方式见 [`../doc/4. 服务器端设计.md`](../doc/4.%20服务器端设计.md) **§2.2.2**。

**审核与对象存储**：**`MODERATION_TEXT_HTTP_URL`** / **`MODERATION_IMAGE_HTTP_URL`**（可选鉴权/超时环境变量见 OpenAPI）；若配置 **`S3_AUDIO_BUCKET`**（及 **`AWS_REGION`**），关采音后可将音频 **Put** 到 S3 并生成短期 **GET 预签名 URL** 供 ASR 拉取（默认不再附带超大 **`audio_base64`**；需要双发时设 **`ASR_SEND_BASE64_WITH_PRESIGNED=1`** 或兼容旧名 **`ASR_HTTP_SEND_BASE64_WITH_PRESIGNED=1`**）。**`S3_PREVIEW_BUCKET`** + **`S3_PREVIEW_UPLOAD`** 等见 [`../contracts/openapi/device-v1-mvp.yaml`](../contracts/openapi/device-v1-mvp.yaml)。

**mTLS 换 JWT**：`device-api` 设 **`MTLS_HEADER_TRUST=1`**、**`TRUSTED_PROXY_IPS`**、**`MTLS_ALLOWED_DEVICE_IDS_JSON`** 或 **`MTLS_TRUST_REGISTERED_DEVICES=1`**；设备经网关带 **`x-device-id-from-mtls`** 调用 **`POST /v1/auth/mtls`**。

**Job 状态多实例**：设置 **`REDIS_URL`** 后，Job 与 **`Idempotency-Key`** 映射写入 Redis（**`REDIS_KEY_PREFIX`**，默认 `fp:`；**`JOB_REDIS_TTL_SEC`**，默认 604800）。**`GET /v1/jobs/{id}`** 在 Redis 下对同一 `job_id` 使用 **`SET NX` 推进锁**（**`JOB_ADVANCE_LOCK_TTL_SEC`** / **`JOB_ADVANCE_LOCK_WAIT_MS`**），释放用 Lua 防误删。冷迁移：**`JOB_REDIS_IMPORT_FILE=1`** + **`JOBS_PERSISTENCE_PATH`** 在启动时灌入 Redis（可选 **`JOB_REDIS_IMPORT_OVERWRITE=1`**）。关机导出：**`JOB_FILE_EXPORT_ON_SHUTDOWN=1`**，**`SCAN`** 写出 JSON 至 **`JOB_FILE_EXPORT_PATH`** 或 **`JOBS_PERSISTENCE_PATH`**。

### 家长 BFF（`parent-bff`）

**开发换票（非量产 OIDC）**

1. `POST /v1/parent/auth/login`，体 `{"email":"you@example.com","password":"…"}`，密码默认与 **`PARENT_DEV_PASSWORD`**（默认 `dev`）一致。  
2. 使用返回的 **`access_token`** 访问 `GET /v1/parent/me` 及 **`/v1/parent/households/{id}/...`** 各路由（当前为占位 JSON）。路径中的 **`household_id` 须与 JWT 内默认家庭一致**，否则 **403**。  
3. `POST /v1/parent/households/{id}/devices/bind`、`.../jobs/{job_id}/approve`、`.../reject` 须带 **`Idempotency-Key`**（内存幂等回放）。  
4. `POST /v1/parent/auth/token` 刷新。

环境变量：`PARENT_JWT_ACCESS_SECRET`、`PARENT_JWT_REFRESH_SECRET`、`PARENT_DEV_PASSWORD`、`PARENT_DEV_HOUSEHOLD_ID`。

HTTP 契约见仓库根 [`../contracts/`](../contracts/)（[`openapi/device-v1-mvp.yaml`](../contracts/openapi/device-v1-mvp.yaml)、[`openapi/parent-v1-mvp.yaml`](../contracts/openapi/parent-v1-mvp.yaml)、[`mqtt/README.md`](../contracts/mqtt/README.md)）。
