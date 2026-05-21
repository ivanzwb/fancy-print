# fancy-print-cloud

云端 TypeScript 工程：**npm workspaces**，入口拆分如下。

| 应用 | 技术栈 | 默认端口 | 说明 |
|------|--------|----------|------|
| `apps/gateway` | Fastify | `3000` | 对外网关：TLS 终结、路由、限流（逻辑随迭代补充） |
| `apps/device-api` | NestJS + Fastify | `3001` | 设备 HTTPS：任务、注册、策略等 |
| `apps/parent-bff` | NestJS + Fastify | `3002` | 家长 BFF：账号强鉴权、家庭与设备视图 |

共享库放在 `packages/*`（示例：`@fancy-print/config`）。

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

健康检查：`GET /health`（各服务一致）。

HTTP 契约与错误码建议维护在仓库根目录 [`../contracts/`](../contracts/)。
