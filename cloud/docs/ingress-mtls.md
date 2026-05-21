# 入口 mTLS（设备通道）

设备 **mTLS** 通常在 **TLS 终结点**（网关 / Ingress / API Gateway）校验 **客户端证书**，后端 `device-api` 仍跑 **普通 HTTPS**（或由网关注入 `X-Client-Cert-*` / mTLS 校验结果头）。本仓库 **`device-api` Nest 进程内不校验客户端证书**；可选在 **`cloud/apps/gateway`** 使用 **Node/Fastify 自带 `https.Server`** 做 **进程内 mTLS 终结**（见下），或由 **Nginx** 终结（推荐产线）。

## fancy-print `gateway` 进程内 mTLS（可选）

| 环境变量 | 说明 |
|----------|------|
| `GATEWAY_TLS_KEY_PATH` / `GATEWAY_TLS_CERT_PATH` | 网关服务端证书（同时启用 HTTPS 监听） |
| `GATEWAY_TLS_CA_PATH` | 签发 **设备客户端证书** 的 CA（用于 `requestCert` 校验链） |
| `GATEWAY_MTLS_REJECT_UNAUTHORIZED` | 默认 `true`；调试可 `false`（**禁止产线**） |
| `GATEWAY_MTLS_SERIAL_MAP_JSON` | 例 `{"1A2B3C":"fancy-print-dev"}`：客户端证书 **序列号**（**大写、无冒号**）→ **`device_id`**；写入下游请求头 **`x-device-id-from-mtls`** |

`device-api` 侧配合：**`MTLS_HEADER_TRUST=1`**、**`TRUSTED_PROXY_IPS`**（默认含本机）、**`MTLS_ALLOWED_DEVICE_IDS_JSON`** 或 **`MTLS_TRUST_REGISTERED_DEVICES=1`**，并调用 **`POST /v1/auth/mtls`** 换发 JWT（见 `contracts/openapi/device-v1-mvp.yaml`）。

## Nginx 示例（概念）

- 客户端 ↔ Nginx：**mTLS**（`ssl_verify_client on` + `ssl_client_certificate` 信任链）。
- Nginx ↔ `device-api`：**内网 HTTP** 或 **再套一层 TLS**（服务间 mTLS 另评）。

```nginx
server {
  listen 443 ssl;
  ssl_certificate     /etc/nginx/certs/server.crt;
  ssl_certificate_key /etc/nginx/certs/server.key;
  ssl_client_certificate /etc/nginx/certs/ca-chain.crt;
  ssl_verify_client on;

  location /v1/ {
    proxy_pass http://device-api:3001;
    proxy_set_header X-Request-Id $request_id;
    proxy_set_header X-Client-Verify $ssl_client_verify;
    proxy_set_header X-Client-DN $ssl_client_s_dn;
  }
}
```

`POST /v1/auth/mtls` 在 **`MTLS_HEADER_TRUST`** 打开且请求来自 **`TRUSTED_PROXY_IPS`** 时，信任 **`x-device-id-from-mtls`** 与允许列表后换发 JWT；量产仍应结合 **§5** 的注册与吊销策略。

## 与 OpenAPI 的关系

OpenAPI 描述 **Bearer** 与 **HTTP 路径**；**mTLS 为传输层策略**，在部署文档与 Ingress 仓库中维护。
