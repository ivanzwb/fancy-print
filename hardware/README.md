# 硬件路线：ZINK 全彩无墨打印

产品中文名 **奇想印印**；代码仓库 **fancy-print**。

本项目打印技术为 **ZINK（Zero Ink）全彩无墨**：染料在 **ZINK 纸** 内扩散显色（对外话术用「ZINK 纸」而非「相纸」），配合线稿 / 淡彩内容策略，交付可再涂色、可剪纸换装的实物；满足 **彩打、接触不易糊** 与 **可涂色、可手工** 的产品目标。**物理出纸 PRD 为 ISO A5（148×210 mm）**；**幅面、介质与 OEM 路径**见 [`demo-kit-bom.md`](demo-kit-bom.md)「与 PRD『A5 出纸』的关系」及下文 **Demo / 工程样机**。

## 量产与端上应用（单一文档）

**[`mass-production-app-dev.md`](mass-production-app-dev.md)** — **量产 OS：Debian / Ubuntu 嵌入式裁剪**（manifest、OTA、产线）；**端上 APP**：`edge-daemon` + UI 分层、IPC、systemd、Remote-SSH / kiosk / CUPS 工程习惯、测试与交付物；与 [`demo-kit-bom.md`](demo-kit-bom.md) 工程样机 **Debian 系 OS** 对齐。

## 工程样机 BOM（采购 / Bring-up）

**[`demo-kit-bom.md`](demo-kit-bom.md)** — 工程样机主清单、Bring-up、**推荐安装的操作系统**（树莓派 / RK3588）、成本与前置验证。

## 请先读

- **[`demo-kit-bom.md`](demo-kit-bom.md)** — 工程样机 **E1～E15**、推荐 OS、**与 A5 PRD 相关的幅面 / 介质 / OEM**；联调前优先通读。

## 归档（勿用于产品路线）

- **[`_archive/esp32-thermal-demo/`](_archive/esp32-thermal-demo/)** — 历史 **UART + ESC/POS 条打** 示例（**非 ZINK 路线**），**已弃用**，仅供工程对照。

## Demo / 工程样机怎么跑（推荐顺序）

1. **工程样机**：按 [`demo-kit-bom.md`](demo-kit-bom.md) 主清单 **E1～E15** 集成，打通「屏上确认 → ZINK 出纸」闭环。  
2. **前置验证（可选）**：手机 + 成品 ZINK 仅做家长/耗材观感，不替代样机。  
3. **勿假设**存在「杜邦线直连开源 ZINK 头」；量产需 **OEM / 授权** 与供应商文档。

## 与仓库其他材料的关系

- [`doc/场景.md`](../doc/场景.md) 已提到 ZINK 成本线，硬件与定价需与之对齐。  
- [`doc/architecture-diagram.svg`](../doc/architecture-diagram.svg) 中 **设备端** 已按 **Debian / Ubuntu 嵌入式裁剪** 展开：UI 应用、`edge-daemon`（CUPS/ZINK）、`cloud-connector`、`ota-agent` 与 **systemd / 只读根+OTA** 基线；云端层仍为 ASR / LLM / 生图 / 审核等。
