# 部署（Docker / Compose / K8s）

面向 **device-api** 的水平部署与 **BullMQ 流水线 Worker** 拆分。网关（gateway）可按需另建镜像，此处以 issue #13 的 device-api 为主。

## 环境变量速查

| 变量 | 说明 |
|------|------|
| `REDIS_URL` | Redis 连接串；BullMQ 与推进锁共用 |
| `PIPELINE_QUEUE_BACKEND` | `inline`（默认）或 `bullmq` |
| `PIPELINE_QUEUE_CONCURRENCY` | BullMQ Worker 并发（默认 8） |
| `PIPELINE_WORKER_STANDALONE` | 设为 `1`/`true`/`yes` 时进程**不监听 HTTP**，仅初始化 Nest 并跑队列 Worker（需 `bullmq` + `REDIS_URL`） |
| `DEVICE_JWT_ACCESS_SECRET` / `DEVICE_JWT_REFRESH_SECRET` | 设备 JWT 签发密钥 |

## Docker 镜像

在**仓库根目录**执行（`context` 为 `.`，以便复制整个 `cloud/` workspace）：

```bash
docker build -f cloud/deploy/docker/Dockerfile.device-api -t fancy-print-device-api:latest .
```

默认 `CMD` 为 HTTP API：`node apps/device-api/dist/main.js`。纯 Worker 使用**同一镜像**，覆盖环境变量 `PIPELINE_WORKER_STANDALONE=1`（见 Compose 示例）。

## Docker Compose

```bash
docker compose -f cloud/deploy/compose/docker-compose.device-api.yml up --build
```

- **device-api**：`http://127.0.0.1:3001/health`
- **device-api-pipeline-worker**：无端口，仅消费 `device-pipeline` 队列

生产前请将 `DEVICE_JWT_*` 换为强随机 Secret（可用 `.env` 文件或 `export` 注入）。

## Kubernetes

示例：`cloud/deploy/k8s/device-api.deployment.yaml`

1. 先构建并推送镜像到集群可拉取的仓库，替换 YAML 中的 `image:`。
2. 创建 Secret（示例键名与 YAML 一致）：

```bash
kubectl create secret generic device-api-secrets \
  --from-literal=redis-url='redis://redis:6379' \
  --from-literal=device-jwt-access-secret='...' \
  --from-literal=device-jwt-refresh-secret='...'
```

3. `kubectl apply -f cloud/deploy/k8s/device-api.deployment.yaml`

**纯 BullMQ Worker**：另建一个 `Deployment`，`replicas` 按需；容器 `image` 相同，`env` 增加 `PIPELINE_WORKER_STANDALONE=1`，**不要**配置 Service/Ingress（无 HTTP）。

## 与集群模式的关系

- **Node cluster**（`CLUSTER_WORKERS`）：子进程仍跑完整 HTTP + 内联或 BullMQ（由环境决定）。
- **独立 Worker 进程**：适合把队列消费与 API 进程分离，缩容 API 而不影响队列吞吐。

## 相关文档

- 服务端设计：`doc/4. 服务器端设计.md` §7.1
- 云端总览：`cloud/README.md`
