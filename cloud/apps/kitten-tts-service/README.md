# Kitten TTS Service

轻量 HTTP 服务，基于 `KittenML/KittenTTS`，输入文本返回语音（WAV 或 base64 JSON）。

默认端口 **3003**（`KITTEN_PORT` 环境变量覆盖）。

## 功能

- `POST /v1/tts/kitten`：文本转语音
- `GET /v1/tts/voices`：查询可用 voice 和 profile 映射
- 支持语音风格切换（如 `child`、`female`、`male`）
- 支持直接指定 `voice` 覆盖 profile

## 安装

```bash
cd cloud/apps/kitten-tts-service
python -m venv .venv
. .venv/Scripts/activate
pip install -r requirements.txt
```

## 启动

```bash
# 直接从 cloud/ 启动
npm run dev:kitten-tts

# 或直接 Python
uvicorn main:app --host 0.0.0.0 --port 3003
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KITTEN_PORT` | `3003` | 监听端口 |
| `KITTEN_MODEL` | `KittenML/kitten-tts-nano-0.8-int8` | HuggingFace 模型名或本地路径（配合 `KITTEN_MODEL_DIR`） |
| `KITTEN_SPEED` | `1.0` | 默认语速 |
| `KITTEN_MODEL_LOAD_TIMEOUT` | `15` | 模型下载超时秒数（含 huggingface_hub 内置 5 次重试，合计约 75s） |
| `KITTEN_MODEL_DIR` | - | 本地模型目录路径（离线部署用） |

## 离线部署（HuggingFace 不可达时）

1. 在能访问 HuggingFace 的机器上下载模型：

```bash
# 安装依赖
pip install huggingface_hub

# 下载 nano 模型到本地目录
python -c "
from huggingface_hub import snapshot_download
snapshot_download('KittenML/kitten-tts-nano-0.8-int8', local_dir='/path/to/models/kitten-tts-nano')
"
```

2. 将模型目录拷贝到本机，启动时指定：

```bash
KITTEN_MODEL_DIR=/path/to/models/kitten-tts-nano uvicorn main:app --host 0.0.0.0 --port 3003
```

> 服务启动时若 HuggingFace 不可达，会在 `KITTEN_MODEL_LOAD_TIMEOUT` 秒后降级，健康检查和 API 仍正常响应，TTS 端点返回 503。

## API 示例

### 1) 获取声音与风格

```bash
curl http://127.0.0.1:3003/v1/tts/voices
```

### 2) 生成 WAV（默认）

```bash
curl -X POST "http://127.0.0.1:3003/v1/tts/kitten" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，我是儿童语音。","profile":"child","speed":1.0,"format":"wav"}' \
  --output output.wav
```

### 3) 生成 base64 JSON

```bash
curl -X POST "http://127.0.0.1:3003/v1/tts/kitten" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好","profile":"female","format":"base64_json"}'
```

## profile 默认映射

- `child` -> `Kiki`
- `female` -> `Luna`
- `female_warm` -> `Rosie`
- `male` -> `Jasper`
- `male_deep` -> `Hugo`
- `assistant` -> `Bella`

> KittenTTS 当前官方 voice 集合以模型内置声音为准，风格映射可以按试听效果继续微调。
