# 奇想印印（fancy-print）

儿童 AI 智能对话打印机 — 项目文档与概念原型（仓库名 **fancy-print**）。

## 仓库布局（代码）

| 路径 | 说明 |
|------|------|
| [`contracts/`](contracts/) | 三端共享：OpenAPI、MQTT 约定等 |
| [`cloud/`](cloud/) | 云端 TypeScript（**npm workspaces**）：**Fastify 网关** + **NestJS（Fastify 适配器）** 的 `device-api` / `parent-bff` |
| [`apps/parent/`](apps/parent/) | 家长端 Flutter（包名 `fancy_print_parent`） |
| [`edge/`](edge/) | 端侧整机软件占位（UI、`edge-daemon`、`cloud-connector`、`ota-agent`） |
| [`infra/`](infra/) | 部署与运维资产占位 |
| [`tools/`](tools/) | 脚本与代码生成等 |
| [`doc/`](doc/) | 产品与架构设计文档 |

详细产品说明见 [`doc/0. 产品构想.md`](doc/0. 产品构想.md)。

**云端**：设备经 `cloud-connector` 对接的 **API / MQTT、内容编排与安全** 见 [`doc/4. 服务器端设计.md`](doc/4. 服务器端设计.md)（与 [`doc/2. 端侧软件与工程样机技术分析.md`](doc/2. 端侧软件与工程样机技术分析.md) **§2.2** 端云边界一致）。

**家长端 App**：移动应用的结构、策略档位与云端 BFF 见 [`doc/5. 家长端应用设计.md`](doc/5. 家长端应用设计.md)。

**端侧软件（整机）**：进程、IPC、主流程与 OTA 导读见 [`doc/3. 端侧设计.md`](doc/3. 端侧设计.md)；完整技术分析与样机 BOM 见 [`doc/2. 端侧软件与工程样机技术分析.md`](doc/2. 端侧软件与工程样机技术分析.md)。

**产品渲染体系**（**整机唯一基准** + **可更换外壳示意**；完整规则见 [`doc/2. 端侧软件与工程样机技术分析.md`](doc/2. 端侧软件与工程样机技术分析.md#product-render-system) **§11**）：

![整机基准渲染（唯一机身基准）](doc/images/整机基准渲染图.png)

![模块化外壳概念（底图为上，矢量叠加）](doc/images/模块化外壳概念图.svg)

## 硬件路线（ZINK）

打印技术已定位为 **ZINK 全彩无墨**，耗材话术统一为 **ZINK 纸**（可涂色、剪纸、换装的手工向，非相纸洗照片）。**ZINK 路线、样机与幅面口径**见 [`doc/2. 端侧软件与工程样机技术分析.md`](doc/2. 端侧软件与工程样机技术分析.md#demo-kit-bom)（**§10** 起：工程样机 BOM / Bring-up；**§1～§9** 量产 OS 与端上应用）。

[**`doc/2. 端侧软件与工程样机技术分析.md`**](doc/2. 端侧软件与工程样机技术分析.md#demo-kit-bom)（**主文档**：量产 OS / 端上应用 **§1～§9**，工程样机硬件 **§10**，成品渲染 **§11**）
