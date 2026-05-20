# 奇想印印 — 成品渲染图体系（机身基准 + 可轻松更换外壳）

本文档规定：**整机造型的唯一基准** 是 [`fancy-print-product-render.png`](fancy-print-product-render.png)（下称 **「基础款基准图」**）。所有对外沟通、结构手板、CMF 讨论，**先对齐这张图里的机身**；动物 / IP / 节日等 **只做可拆卸外壳 SKU**，避免多套渲染各画各的、机身漂移。

---

## 1. 产品定义（与 PRD / BOM 对齐）

- **一体便携机**：约 **6 寸触屏**、**A5 级 ZINK 出纸**、语音与 **PTT**、**Type-C**、内置电池等，与 [`demo-kit-bom.md`](../hardware/demo-kit-bom.md)、[`项目计划书-儿童AI打印机.md`](项目计划书-儿童AI打印机.md) 一致。  
- **中文品牌**：奇想印印；**仓库名**：fancy-print。

---

## 2. 两层结构（必须遵守）

| 层级 | 名称 | 说明 |
|------|------|------|
| **A. 基础款机身（唯一基准）** | **Chassis / 主机外观** | **以 `fancy-print-product-render.png` 为准**：前面板触屏与边框比例、出纸口位置、PTT、侧孔与整体比例 **冻结**。后续改 CMF（纹理、分模线）须在 **同一造型骨架** 上做 delta，**不另起一张「全新机身」渲染当主图**。 |
| **B. 可更换外壳（多样 SKU）** | **Shell / 主题壳** | 仅包覆 **打印仓上方至机身后上沿**（或结构定义的「装饰环」），通过 **磁吸、卡扣或滑轨** 实现 **单手快拆**（工程验证见样机 BOM 与热设计）。**动物、联名、季节主题** 等 **只体现在 B 层**；壳的款数 **可无限扩展**，不要求与基准图同一次 AI 生成。 |

**一句话**：**一张基础款定江山**；外壳是 **配件族**，可多样、可迭代，但 **不得改 A 层屏幕与纸路关系**。

---

## 3. 制图与资产流程（推荐）

1. **机身**：以 **`fancy-print-product-render.png`** 为母图；若需更新机身，**替换该文件并保留版本说明**（可在本段下追加变更记录）。  
2. **外壳单品**：在 [`renders/shells/`](renders/shells/) 下新增 PNG（命名建议 `shell-{主题}-{版本}.png`），可为 **仅外壳 exploded** 或与 **实物主机合影**；若用合成，须 **透视与光照** 与基准图一致。  
3. **组合图**：用设计工具将 **壳 B** 叠到 **基准图 A** 上出稿，比「多张整机各自 AI 生成」更易对齐。  
4. **示意结构**：[`fancy-print-modular-concept.svg`](fancy-print-modular-concept.svg) 为 **模块化叙事** 主文件：**左侧 `<image>` 直接引用** `fancy-print-product-render.png`（同目录），右侧为矢量「壳」占位与箭头；**非**第二台整机 AI 渲染。若需发 PNG，可在浏览器打开该 SVG 后导出位图（底图仍来自基准 PNG）。

---

## 4. 仓库内文件角色

| 文件 | 角色 |
|------|------|
| [`fancy-print-product-render.png`](fancy-print-product-render.png) | **唯一基础款整机基准（A）**。 |
| [`fancy-print-modular-concept.svg`](fancy-print-modular-concept.svg) | **快换外壳概念示意**：**嵌入** `fancy-print-product-render.png` + 矢量快拆区与壳占位；非比例工程图。 |
| [`renders/shells/README.md`](renders/shells/README.md) | 外壳素材目录说明；具体壳图 **陆续放入该目录**。 |

---

## 5. 与结构 / 量产的衔接（备忘）

- **止口、磁吸力、跌落、热区**：以结构 + [`demo-kit-bom.md`](../hardware/demo-kit-bom.md) 温升与走纸为准。  
- **天线 / 麦孔**：若壳体遮挡，须在 B 层开透声/透波孔或改材料，**不得私自移动 A 层开孔**。

---

## 6. 变更记录

| 日期 | 说明 |
|------|------|
| （本版） | 模块化示意改为 **`fancy-print-modular-concept.svg`**：用 `<image href="fancy-print-product-render.png">` **嵌入唯一基准图**，删除独立生成的 `fancy-print-modular-concept.png`，避免「另一台整机」。 |
| （此前） | 撤销以 `fancy-print-platform-*.png` 为整机基准；改以 `fancy-print-product-render.png` 为唯一机身基准，外壳为可扩展 SKU。 |

---

**维护**：更新基准图或新增外壳目录文件时，同步更新本文件与根目录 [`README.md`](../README.md)。
