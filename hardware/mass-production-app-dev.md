# 量产应用开发方案（操作系统 + 端上 APP）

工程样机在 **Debian 系**环境上验证业务：**默认 Raspberry Pi OS**（与 Debian 同源），或 **板厂提供的 Debian / Ubuntu** 镜像（见 [`demo-kit-bom.md`](demo-kit-bom.md)「工程样机操作系统」）；量产在 **定制主板 + 选定 SoC**（见 [`doc/项目计划书-儿童AI打印机.md`](../doc/项目计划书-儿童AI打印机.md) **§5.1 / §6.2**）上交付**同源工具链**下的 **裁剪 Debian / Ubuntu** 根文件系统。

**量产操作系统已定稿**：**Debian / Ubuntu 嵌入式裁剪**（见 **§2**）。以下 **OS 基线、分层、OTA、产测、CI** 与 **端上应用**（UI、`edge-daemon`、IPC、systemd、开发工作流、测试与交付物）均在同一文档内展开；与工程样机的差别主要在 **系统形态、进程可靠性与升级机制**，业务接口应尽早对齐。

**与工程样机的同一主线**：样机阶段允许的 **apt / 多包调试**，在量产收口为 **manifest 白名单包集 + 只读根 + 自家 OTA**；业务进程、**CUPS/`lp`**、IPC 契约应自样机继承，避免换发行版或换打印栈。

---

## 1. 量产与工程样机的本质差别

| 维度 | 工程样机（**Debian 系**：Pi OS / 板厂 Debian·Ubuntu） | 量产 |
|------|------------------|------|
| 硬件 | 树莓派等 **开发板** | **定制 PCB** + 选型 SoC / 存储 / 屏模组 |
| 系统 | **官方 Pi OS 或板厂 Debian/Ubuntu**，开发期可 **apt** 装包 | **裁剪 Debian/Ubuntu** + **只读根** + **受控 OTA**（见 **§2**）；**禁止**依赖用户 `apt upgrade` |
| 应用 | 可 Python + venv、Chromium kiosk | 强调 **启动时间、内存占用、看门狗、OTA、签名校验** |
| 维护 | 人工 SSH | **远程 OTA**、日志与版本矩阵 |

量产阶段应把「能跑」升级为 **「产线可烧录、现场可回滚、家长端可预期」**。

---

## 2. 量产操作系统基线（**已定稿：Debian / Ubuntu 嵌入式裁剪**）

在 SoC 厂 **Linux BSP** 上交付 **裁剪后的 Debian 或 Ubuntu**（Server / Minimal / 板厂预集成镜像再瘦身均可），用 **preseed、debootstrap 或镜像流水线** 砍掉无关包，只保留 **systemd、网络、音频、显示、USB、CUPS/IPP、OTA agent** 等与 PRD 直接相关的栈。量产形态为 **只读根 + overlay**（或 **A/B rootfs**），升级走 **签名 OTA**，**禁止**依赖终端用户随意 `apt upgrade` 改内核。

与工程样机 **Raspberry Pi OS** 同属 Debian 系，**打印（`lp` / CUPS）、SSH 排障、包构建习惯** 可从样机平滑延续，减少「样机能打、量产推倒」的返工。

**与 Android**：Android **不作为本项目量产主路径**。若将来供应商 **仅** 提供 Android 打印 SDK，须走 **变更控制 / 单独立项** 再评估（本仓库不再维护 OS 对照专文）。

### 2.1 其它基线（未采纳，备忘）

| 代号 | 概要 | 未选作本项目主方案的原因 |
|------|------|--------------------------|
| **Buildroot / Yocto 极小 rootfs** | 镜像更小、攻击面更可控 | 包生态弱于 Debian；从 Pi 样机迁移植与联调成本更高；**仅在未来存储或启动指标极端吃紧时** 再单列评估 |
| **Android** | HAL + 应用以 Java/Kotlin 为主 | 与仓库主线 **Linux + CUPS + ZINK（`demo-kit-bom` / `hardware/README`）** 不一致；打印与常驻后台服务不确定性大 |

### 2.2 镜像与包清单（与工程样机对齐）

量产 rootfs 不是「另起炉灶换发行版」，而是在 **与样机相同的 Debian/Ubuntu 包命名空间** 内做减法与冻结：

1. **样机冻结输出**：在 Pi OS 或板厂 Debian/Ubuntu 上记录 **`uname -r`、CUPS/打印相关包、音频栈、显示栈** 的版本；导出 **`dpkg --get-selections`**（或 Ubuntu manifest 等价物）作为 **白名单初稿**。  
2. **流水线构建**：用 **debootstrap + 显式包列表**（或板厂 SDK + 再瘦身）在 CI 中 **可重复构建** rootfs，与样机行为 diff；禁止依赖工程师本机「随手 apt」。  
3. **收口策略**：量产镜像 **仅含白名单包**；开发期多装的调试工具在 **发布分支** 剔除；与 [`demo-kit-bom.md`](demo-kit-bom.md)「版本冻结」及本文 **§7.1 工程样机阶段** 的工程习惯一致。  
4. **内核与驱动**：跟随 SoC 厂 **LTS / BSP 分支**；与样机曾验证过的 **屏、USB、声卡** 组合写进 **硬件兼容性矩阵**，OTA 升级时同测。

---

## 3. 目标与职责边界（端上应用）

| 项 | 说明 |
|----|------|
| **端上职责** | 触屏看图确认、家长锁、本地缓存、调用 **打印/音频/网络**；**不**在 UI 进程内直接操作 USB 打印机字节流（交给 `edge-daemon`）。 |
| **云端职责** | ASR、文生图、审核、家长策略；端上通过 **HTTPS / MQTT** 与下文架构中的 **cloud-connector** 层对接。 |
| **系统约束** | 根文件系统 **只读 + overlay**（或 A/B）；应用以 **systemd 服务** 托管；升级走 **OTA**，不依赖用户 `apt upgrade`。 |
| **与样机关系** | 先在 Pi OS / 板厂镜像上跑通功能，再 **收敛包集合** 与启动路径，使 CI 产出的 rootfs 与样机行为一致（见 **§2.2**）。 |

---

## 4. 应用架构（推荐：分层 + 单职责进程）

把 **硬件敏感逻辑** 和 **UI** 拆开，便于产测、回滚和替换 UI 技术栈。

```
┌─────────────────────────────────────────┐
│  UI 层（看图确认、家长锁、设置）          │
│  全屏 kiosk 或 Qt 主窗口                 │
└─────────────────┬───────────────────────┘
                  │ 本地 IPC（D-Bus / Unix socket / gRPC；择一，全仓库统一）
┌─────────────────▼───────────────────────┐
│  edge-daemon（常驻，C++/Rust/Go）         │
│  · 打印队列 · ZINK/CUPS 或厂商 SDK        │
│  · 音频采集/播放 · 唤醒/PTT GPIO          │
│  · 离线任务队列 · 磁盘缓存                │
└─────────────────┬───────────────────────┘
                  │ HTTPS / MQTT
┌─────────────────▼───────────────────────┐
│  cloud-connector                        │
│  （可与 daemon 同二进制或拆分）           │
└─────────────────────────────────────────┘
        并行：ota-agent（AB 分区 + 签名验签）
```

**原则**：UI **崩溃不丢打印队列**；daemon **无界面**、可独立升级（版本矩阵与 OTA 包拆分约定见 **§11**）。**UI 选型（量产）** 的对比与 Debian 上注意点见 **§5**；**IPC 契约** 见 **§6**；**开发工作流与 manifest 收口** 见 **§7**。

---

## 5. UI 技术路线（三选一，可阶段切换）

| 路线 | 适用 | Debian 上注意点 |
|------|------|----------------|
| **Qt 6（QML/C++）** | 一体机动画、多页导航、与 Wayland/X11 成熟集成；工业与嵌入式成熟 | 依赖 `qt6-base` 等，须纳入 **manifest**；交叉编译或板载原生编。**本项目** 与 **裁剪 Debian** 组合即可。 |
| **嵌入式 Web（本地 HTTP + WebView）** | 与样机 **Web+kiosk** 延续最快；量产可与 **WebEngine / Qt WASM** 思路衔接 | 量产用 **Qt WebEngine** 或 **WPE WebKit**（`wpe-webkit`），避免完整桌面 Chromium；静态资源可放只读分区。 |
| **LVGL + 自绘框架** | 极低内存、极简 UI；偏「单片机级」体验 | 与显示栈（DRM/KMS 或 fb）绑定深，Bring-up 成本高于 Qt/Web。 |

**不建议量产默认**：在嵌入式 Linux 上跑 **完整桌面 Chromium + Electron** 作唯一 UI（内存与 OTA 体积压力大）；若产品坚持 Web UI，优先 **裁剪浏览器壳 + 单页应用**（**WebEngine** 或 **wpe-webkit** 替代完整 Chromium）。

---

## 6. 与 `edge-daemon` 的接口契约（须文档化 + 版本号）

建议在仓库内维护 **OpenAPI 或 protobuf** 定义（与 **§10** 工程衔接一致），至少覆盖：

- **预览**：云端返回的预览 URL 或本地渲染后的缩略图路径。  
- **打印任务**：任务 ID、纸张规格（A5 PRD）、色彩/线稿模式、优先级、超时。  
- **错误码**：可映射到 UI 文案（卡纸、缺纸、网络、审核拒绝等）。  
- **家长锁状态**：只读查询 + 受控写（daemon 侧校验）。

UI **只通过 IPC 调 daemon**，不直接 `lp`（便于产测 mock 与权限收敛）。

---

## 7. 开发环境与工作流

### 7.1 工程样机阶段（可 `apt`）

- **IDE**：VS Code / Cursor **Remote-SSH** 到板子（板端启用 `ssh`；与 [`demo-kit-bom.md`](demo-kit-bom.md) 工程样机 OS 表同一 **Debian 系**镜像即可）。  
- **依赖**：允许 `apt install` 调试包；**每周**导出 `dpkg --get-selections` 或与量产共用的 **包列表 YAML**，标记「仅开发 / 可进量产」。  
- **显示**：Wayland（如 labwc/Weston）或 X11；与量产目标显示栈 **尽早对齐**，避免量产换合成器导致 Qt/Web 行为变化。

### 7.2 量产前收口

- 应用与依赖改为：**CI 内 debootstrap + manifest 安装** 或可复现的 **`.deb` / 静态二进制** 拷入 rootfs。  
- 移除开发 SSH 密钥、编译器、无关字体与文档包（见 [`demo-kit-bom.md`](demo-kit-bom.md)「与量产衔接」表）。  
- **内核、CUPS、声卡** 版本写入 **硬件兼容性矩阵**（**§2.2**）。

### 7.3 交叉编译（可选）

- 在 **Debian/Ubuntu x86_64** 上使用与目标 ABI 一致的 **toolchain + sysroot**（或 `sbuild`/`pbuilder` arm64）；  
- 产出物：带符号的 **debug 包** 仅进内测通道；发布通道 **strip + 符号表分离**。

---

## 8. systemd 与自启动

| 单元 | 建议 |
|------|------|
| `edge-daemon.service` | `After=network-online.target`，`Restart=always`，限频重启；环境变量放 `EnvironmentFile=-/etc/fancy-print/device.env`。 |
| `fancy-print-ui.service` | `After=edge-daemon.service`；失败策略与看门狗（可选 `systemd-run` + 硬件狗）与产品商定。 |
| `ota-agent.service` | 独立用户/能力；仅写 OTA 分区与状态文件。 |

**图形会话**：若用 kiosk，可用 **自动登录 tty + startx** 或 **Wayland compositor 自启**；避免完整 GNOME/KDE。

---

## 9. 打印、音频、触屏（应用侧调用方式）

- **打印**：UI → IPC → daemon → **`lp` / libcups / 厂商 SDK`**；A5 与 ZINK 介质边界见 [`demo-kit-bom.md`](demo-kit-bom.md) 及 [`README.md`](README.md)（硬件入口）中的 ZINK / A5 口径。  
- **音频**：优先 **PipeWire**（与多数 Debian 系镜像一致）；daemon 或专用 `audio-helper` 暴露 **录音/播放/设备切换** IPC，避免多进程争用设备。  
- **触屏**：校准文件提交到镜像只读层或 overlay；分辨率与 DPI 与 **PRD 屏规格** 一致（见 BOM）。

---

## 10. 与工程样机的衔接（降低返工）

以下假设样机已按 [`demo-kit-bom.md`](demo-kit-bom.md) 选用 **Debian 系 OS** 并完成「与量产衔接」收口检查中的打印 / 音频 / 触摸验证。

1. **接口契约先行**：在 Pi 上把 **「预览 URL / 打印任务 JSON / 错误码」** 定成 **OpenAPI 或 protobuf**，量产 `edge-daemon` 实现同一契约，UI 可少改（见 **§6**）。  
2. **业务逻辑上移**：ASR、文生图、审核尽量 **云端**；端上只做 **缓存、重试、脱敏日志**。  
3. **打印抽象**：样机用 `lp`；量产在 daemon 内封装 **`PrintJob`**，底层接 **CUPS 或厂商闭源库**，UI 不感知。  
4. **配置**：用 **单一配置文件**（或只读分区 + 可写 overlay）描述打印机型号、屏参数、功能开关，产线 **每台灯写入序列号与校准数据**。

详见 **§6、§7.1** 与 [`demo-kit-bom.md`](demo-kit-bom.md)（OS 与 Bring-up），作为 **协议与交互** 的参考实现，而非最终部署形态。

---

## 11. OTA、版本与回滚（量产必备）

| 项 | 建议 |
|----|------|
| **分区** | **A/B rootfs** 或 **双槽镜像**；升级失败 **自动回滚** 到上一版本。 |
| **签名** | 镜像与增量包 **私钥签名、设备验签**；禁止未签名包写入启动分区。 |
| **通道** | **灰度**：先内测设备号段，再全量。 |
| **遥测** | 脱敏 **崩溃栈、打印失败码、OTA 结果**；合规与隐私条款前置。 |

量产 **禁止**依赖用户 `apt upgrade` 随机升级内核（与工程样机「冻结版本」一致，但量产用 **自家 OTA** 管控）。

---

## 12. 产线与质量

- **工厂镜像**：一条命令烧录 **eMMC/闪存**；镜像为 **裁剪 Debian/Ubuntu** 分区布局（只读根 + overlay 或 A/B）；首次开机 **自检**（屏、触摸、麦、喇叭、走纸、WiFi）。  
- **老化**：高温高湿与 **连续打印 N 次** 写入产测脚本，与 [`demo-kit-bom.md`](demo-kit-bom.md) Bring-up 最后一环对齐。  
- **CI**：在 **Debian/Ubuntu 容器或 debootstrap 环境** 内编 **rootfs manifest**、编 **edge-daemon / UI**；能跑 **单元测试 + 模拟打印**；关键路径 **夜间硬件台架**（可选，尽量复用与样机相同的 SoC 板）。

---

## 13. 安全与儿童场景（底线）

- **HTTPS 固定证书链**、**证书钉扎**（视威胁模型）；密钥 **不可明文** 打在镜像里，用 **每机注入** 或安全元件（与 **§14** 一致）。  
- **内容安全**：与云端审核策略一致；端上 **家长锁 / 打印确认** 与 PRD 对齐。  
- **依赖与 CVE**：量产 rootfs **只包含必要包**，建立 **CVE 扫描与 LTS 内核** 节奏。

---

## 14. 配置、密钥与隐私

- **全局配置**：`/etc/fancy-print/config.yaml`（只读分区）+ `/var/lib/fancy-print/`（可写 overlay）分状态与缓存。  
- **密钥**：不进 Git；产线 **每机注入** WiFi 凭证、设备证书等（与 **§13** 对齐）。  
- **日志**：结构化日志 + 崩溃转储路径受控；上传前 **脱敏**（无儿童语音原文持久明文等，与法务/PRD 对齐）。

---

## 15. 测试清单（APP 团队）

| 类型 | 内容 |
|------|------|
| **单元** | IPC 编解码、错误码映射、离线队列重试。 |
| **集成** | daemon + CUPS 假队列 / 真机 E5；断网、弱网、云端 429/5xx。 |
| **E2E** | Bring-up 第 5 步「连续对话打印 N 次」脚本化（见 [`demo-kit-bom.md`](demo-kit-bom.md)）。 |
| **OTA** | A/B 切换后 UI 与 daemon 版本匹配；回滚后配置不损坏。 |

---

## 16. 交付物（建议纳入版本发布）

1. UI 与 daemon **可执行文件 + systemd unit**。  
2. **IPC 契约**（OpenAPI/proto）与 **错误码表**。  
3. **manifest 片段**（应用依赖包列表，与量产 rootfs 合并说明）。  
4. **操作说明**：工厂自检模式入口、日志抓取命令（供售后）。

---

## 17. 相关文档

| 文档 | 用途 |
|------|------|
| [`demo-kit-bom.md`](demo-kit-bom.md) | 工程样机硬件与 **Debian 系 OS**、Bring-up；**A5 PRD、幅面 / ZINK 介质与 OEM**（与 [`README.md`](README.md) ZINK 话术一致；与 **§2** 同源；工程习惯与 **§7.1** 对齐） |
| [`../doc/项目计划书-儿童AI打印机.md`](../doc/项目计划书-儿童AI打印机.md) | 产品、SoC、BOM、定价 |

---

**一句话**：量产应用 = **裁剪 Debian/Ubuntu + 只读/overlay + 常驻 edge-daemon 管硬件 + Qt/LVGL/裁剪 Web 做 UI + 签名 OTA**；端上实现上 **薄 UI + 厚 daemon + 稳定 IPC + systemd 托管 + manifest 可复现构建**；与树莓派样机的差别主要在 **系统形态、进程可靠性和升级机制**，业务接口应尽早对齐，减少从样机到量产的推倒重来。
