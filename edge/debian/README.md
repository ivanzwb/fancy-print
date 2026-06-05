# Debian 端侧软件 (edge/debian)

Debian 是奇想印印端侧软件的量产主线平台，基于 Debian 12 (Bookworm) + ARM64 (RK3568)。

## 组件

| 组件 | 目录 | 语言 | 说明 |
|------|------|------|------|
| **edge-daemon** | `edge-daemon/` | Go | 核心守护进程：打印队列、音频管理、GPIO、gRPC IPC |
| **edge-ui-server** | `edge-daemon/cmd/edge-ui-server/` | Go | UI 静态文件 HTTP 服务（SPA） |
| **fancy-print-ui** | `fancy-print-ui/` | TypeScript/React | 儿童触屏 Web UI (kiosk) |
| **系统服务** | `systemd/` | 配置 | systemd unit 文件 |

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                 kiosk 浏览器                      │
│          (WPE WebKit / Chromium kiosk)           │
│                     │ HTTP                       │
│                     ▼                            │
│  ┌─────────────────────────────────────┐         │
│  │       fancy-print-ui (React SPA)    │         │
│  │       localhost:3000                │         │
│  └──────────┬──────────────────────────┘         │
│             │ gRPC (connect-web)                 │
│             ▼                                    │
│  ┌─────────────────────────────────────┐         │
│  │       edge-daemon (Go)              │         │
│  │       gRPC :9090                    │         │
│  │  ┌─────┬──────┬─────┬──────┐       │         │
│  │  │打印 │ 音频 │ GPIO │ 云连接│       │         │
│  │  └─────┴──────┴─────┴──────┘       │         │
│  └─────────────────────────────────────┘         │
│                                                 │
│  ┌─────────────────────────────────────┐         │
│  │       ota-agent (Go)                │         │
│  │       每天 03:00 (systemd timer)    │         │
│  └─────────────────────────────────────┘         │
└─────────────────────────────────────────────────┘
```

## 构建与部署

### 前提

- Go 1.22+
- Node.js 20+ / pnpm
- buf (protobuf 代码生成)

### 编译

```bash
# edge-daemon + edge-ui-server
cd edge-daemon
export GOPROXY=https://goproxy.cn,direct
go build -o edge-daemon ./cmd/edge-daemon/
go build -o edge-ui-server ./cmd/edge-ui-server/

# fancy-print-ui
cd fancy-print-ui
npm install && npm run build

# ota-agent
cd ../../ota-agent
go build -o ota-agent .
```

### 安装

```bash
# 二进制
install -m 755 edge-daemon /usr/local/bin/
install -m 755 edge-ui-server /usr/local/bin/
install -m 755 ota-agent /usr/local/bin/

# UI 静态文件
mkdir -p /usr/share/fancy-print-ui
cp -r fancy-print-ui/dist/* /usr/share/fancy-print-ui/

# 配置
mkdir -p /etc/fancy-print
install -m 644 config.yaml.example /etc/fancy-print/config.yaml

# 数据目录
mkdir -p /var/lib/fancy-print/audio
mkdir -p /var/cache/fancy-print

# systemd 服务
cp systemd/*.service systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now edge-daemon fancy-print-ui ota-agent.timer

# 用户
useradd -r -s /usr/sbin/nologin fancy-print
```

### 交叉编译 (ARM64)

```bash
GOOS=linux GOARCH=arm64 go build -o edge-daemon-arm64 ./cmd/edge-daemon/
GOOS=linux GOARCH=arm64 go build -o edge-ui-server-arm64 ./cmd/edge-ui-server/
GOOS=linux GOARCH=arm64 go build -o ota-agent-arm64 ./cmd/ota-agent/
```

## IPC 接口

进程间通信使用 gRPC (Protocol Buffers)：

- 服务定义：`../../contracts/proto/edge_ipc.proto`
- Go 服务端：`internal/ipc/service.go`（25 个 RPC）
- TS 客户端：`fancy-print-ui/src/gen/`（通过 `buf generate` 生成）

### 主要 RPC

| RPC | 方向 | 说明 |
|-----|------|------|
| `GetState` | UI → 守护进程 | 设备状态查询 |
| `StartRecording` / `StopRecording` | UI → 守护进程 | PTT 录音 |
| `PrintContent` | UI → 守护进程 | 提交打印 |
| `GetPrintQueue` | UI → 守护进程 | 打印队列 |
| `ValidatePin` | UI → 守护进程 | 家长锁验证 |
| `CheckUpdate` | UI → 守护进程 | OTA 检查 |

完整列表见 `contracts/proto/edge_ipc.proto`。

## 系统服务

| 服务 | 类型 | 说明 |
|------|------|------|
| `edge-daemon.service` | 常驻 | 核心守护进程 |
| `fancy-print-ui.service` | 常驻 | UI HTTP 服务 |
| `ota-agent.service` | oneshot | OTA 更新检查 |
| `ota-agent.timer` | timer | 每日 03:00 ±30min 触发 OTA |

## 对应文档

- 进程模型：`doc/3. 端侧设计.md §2.1`
- OTA 更新：`doc/3. 端侧设计.md §2.2`
- 技术分析：`doc/2. 端侧软件与工程样机技术分析.md`
