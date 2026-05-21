# 家长端（Flutter）

与 [`doc/5. 家长端应用设计.md`](../../doc/5. 家长端应用设计.md) 对齐；默认通过云端 [`parent-bff`](../../cloud/README.md) 访问业务接口（具体路径以 `contracts/openapi` 为准）。

## 首次生成平台工程

本仓库已包含 `pubspec.yaml` 与 `lib/`。若目录下尚无 `android/`、`ios/` 等，请在安装 [Flutter](https://flutter.dev/) 后在本目录执行：

```bash
flutter create . --org com.fancyprint.parent
```

再根据团队规范调整包名与签名配置。

## 常用命令

```bash
flutter pub get
flutter run
flutter test
```
