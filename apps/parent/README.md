# 家长端（Flutter）

与 [`doc/5. 家长端应用设计.md`](../../doc/5. 家长端应用设计.md) 对齐；默认通过云端 [`parent-bff`](../../cloud/apps/parent-bff) 访问 `/v1/parent/...`（合约见 [`contracts/openapi/parent-v1-mvp.yaml`](../../contracts/openapi/parent-v1-mvp.yaml)）。

## MVP 范围（doc/5 §9）

- 登录（开发态邮箱 + `PARENT_DEV_PASSWORD`；正式态走 OIDC，后端 `OidcService` 已就绪）
- 首页：设备摘要、当前策略、最近创作
- 动态时间线（缩略元数据，不展开 prompt 原文）
- 设备：在线态、短码绑定、解绑
- 策略：档位 A/B/C 展示 + 远程闸门开关（携 `expected_version`，命中 409 自动刷新）
- 远程批准（档位 B）：手动输入 Job ID 触发 approve / reject 并查看历史决定
- 我的：账号信息、隐私 / 注销 / 帮助 / ZINK 纸入口（占位）、退出登录

## 工程结构

```
lib/
  main.dart                 // App 入口与 AuthGate
  theme.dart                // 颜色 / 组件主题
  api/
    api_client.dart         // HTTP 客户端：401 自动 refresh、Idempotency-Key
    models.dart             // 与 parent-bff 对齐的 JSON 模型
  state/
    auth_controller.dart    // 令牌持久化 + 会话状态（ChangeNotifier）
  screens/
    login_screen.dart
    home_shell.dart         // 底栏一级导航
    home_tab.dart
    timeline_tab.dart
    devices_tab.dart
    bind_device_screen.dart
    policy_tab.dart
    approvals_screen.dart
    me_tab.dart
```

## 首次生成平台工程

仓库目前已包含 `pubspec.yaml` / `lib/` / `test/`。若目录下尚无 `android/`、`ios/` 等平台目录，安装 [Flutter](https://flutter.dev/) 后在本目录执行：

```bash
flutter create . --org com.fancyprint.parent
```

再根据团队规范调整包名与签名配置。

## 常用命令

```bash
flutter pub get
# 默认指向本机 parent-bff（http://127.0.0.1:3002）
flutter run --dart-define=PARENT_BFF_URL=http://127.0.0.1:3002
# 经 gateway
flutter run --dart-define=PARENT_BFF_URL=http://127.0.0.1:3000
flutter test
```

## 仍待补齐 / 路线图

- 推送与应用内收件箱（doc/5 §4.6）
- 成长相册浏览 / 导出与 VIP（§4.5）
- 二维码扫码、设备短码 OCR
- 多孩档案切换、家庭成员管理
- OIDC 登录入口接入
