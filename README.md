# 奇想印印（fancy-print）

儿童 AI 智能对话打印机 — 项目文档与概念原型（仓库名 **fancy-print**）。

详细产品说明见 [`doc/idea.md`](doc/idea.md)。

**产品渲染体系**：**整机唯一基准** 为 [`doc/fancy-print-product-render.png`](doc/fancy-print-product-render.png)；其上加 **可轻松更换** 的多样主题外壳（动物 / 联名等）。说明见 [`doc/product-render-system.md`](doc/product-render-system.md) · **模块化示意（底图即基准 PNG，矢量叠加）** [`doc/fancy-print-modular-concept.svg`](doc/fancy-print-modular-concept.svg) · 外壳素材目录 [`doc/renders/shells/`](doc/renders/shells/)。

## 硬件路线（ZINK）

打印技术已定位为 **ZINK 全彩无墨**，耗材话术统一为 **ZINK 纸**（可涂色、剪纸、换装的手工向，非相纸洗照片）。**ZINK 路线、样机与幅面口径**见 [`hardware/README.md`](hardware/README.md) 与 [`hardware/demo-kit-bom.md`](hardware/demo-kit-bom.md)；工程归档（旧 UART 条打示例，**非 ZINK**）见 [`hardware/_archive/esp32-thermal-demo/`](hardware/_archive/esp32-thermal-demo/)。

[`hardware/README.md`](hardware/README.md) · [**`hardware/demo-kit-bom.md`**](hardware/demo-kit-bom.md)（工程样机 BOM） · [**`hardware/production-app-dev.md`**](hardware/production-app-dev.md)（**量产 OS + 端上 APP**）
