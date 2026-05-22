# 部署（Docker / Compose / K8s）

**运维总览（中文）**：[`../../doc/6. 服务器运维手册.md`](../../doc/6.%20服务器运维手册.md)（一键脚本、日常运维、排障）。

- **全栈一键**：`cloud/deploy/compose/docker-compose.stack.yml`（Redis + device-api + pipeline worker + parent-bff + gateway），由 [`scripts/deploy.sh`](scripts/deploy.sh) 调用。
- **仅设备通道**：`cloud/deploy/compose/docker-compose.device-api.yml`（`deploy.sh --device-only`）。

镜像定义：

| Dockerfile | 镜像用途 |
|------------|----------|
| [`docker/Dockerfile.device-api`](docker/Dockerfile.device-api) | device-api（默认 HTTP；可配 `PIPELINE_WORKER_STANDALONE`） |
| [`docker/Dockerfile.gateway`](docker/Dockerfile.gateway) | gateway |
| [`docker/Dockerfile.parent-bff`](docker/Dockerfile.parent-bff) | parent-bff |

面向 **device-api** 的水平扩展与 **BullMQ 流水线 Worker** 拆分说明见下文；网关与 BFF 已纳入全栈 Compose。

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
docker build -f cloud/deploy/docker/Dockerfile.gateway -t fancy-print-gateway:latest .
docker build -f cloud/deploy/docker/Dockerfile.parent-bff -t fancy-print-parent-bff:latest .
```

device-api 默认 `CMD` 为 HTTP API：`node apps/device-api/dist/main.js`。纯 Worker 使用**同一镜像**，覆盖环境变量 `PIPELINE_WORKER_STANDALONE=1`（见 Compose 示例）。

## 一键脚本（Linux / WSL）

```bash
chmod +x cloud/deploy/scripts/*.sh
cp cloud/deploy/env/stack.example.env cloud/deploy/env/stack.env   # 首次：改密钥
./cloud/deploy/scripts/deploy.sh                                   # 全栈
./cloud/deploy/scripts/deploy.sh --device-only                     # 仅设备栈
./cloud/deploy/scripts/healthcheck.sh
./cloud/deploy/scripts/stop.sh
```

详见 [`doc/6. 服务器运维手册.md`](../../doc/6.%20服务器运维手册.md)。

## Docker Compose

```bash
docker compose -f cloud/deploy/compose/docker-compose.stack.yml --env-file cloud/deploy/env/stack.env up -d --build
# 或
./cloud/deploy/scripts/deploy.sh
```

```bash
docker compose -f cloud/deploy/compose/docker-compose.device-api.yml up --build
```

- **全栈**：gateway **3000**、device-api **3001**、parent-bff **3002**（见 `stack.example.env`）
- **device-api 演示**：`http://127.0.0.1:3001/health`
- **device-api-pipeline-worker**：无端口，消费 BullMQ 队列（名称默认 **`fp:job-pipeline-advance`**，可用 `BULLMQ_PIPELINE_QUEUE_NAME` 覆盖）

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
