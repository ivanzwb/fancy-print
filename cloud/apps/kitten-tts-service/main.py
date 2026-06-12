from __future__ import annotations

import asyncio
import io
import os
import re
import socket
import unittest.mock as _mock
import wave
from dataclasses import dataclass
from threading import Thread
from typing import Dict, List, Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

MODEL_LOAD_TIMEOUT = int(os.getenv("KITTEN_MODEL_LOAD_TIMEOUT", "15"))
socket.setdefaulttimeout(MODEL_LOAD_TIMEOUT)

# ── KittenTTS（本地，英文，可选） ───────────────────────────────────
try:
    from kittentts import KittenTTS as _KittenTTS
    _KITTENTTS_AVAILABLE = True
except ImportError:
    _KittenTTS = None
    _KITTENTTS_AVAILABLE = False

# ── edge-tts（云端，中文+英文，可选） ──────────────────────────────
try:
    import edge_tts as _edge_tts
    _EDGE_TTS_AVAILABLE = True
except ImportError:
    _edge_tts = None  # type: ignore
    _EDGE_TTS_AVAILABLE = False

DEFAULT_MODEL = os.getenv("KITTEN_MODEL", "KittenML/kitten-tts-micro-0.8")
DEFAULT_SPEED = float(os.getenv("KITTEN_SPEED", "1.0"))
DEFAULT_PORT = int(os.getenv("KITTEN_PORT", "3003"))
MODEL_DIR = os.getenv("KITTEN_MODEL_DIR")


@dataclass(frozen=True)
class VoiceProfile:
    name: str
    default_voice: str
    aliases: List[str]


VOICE_PROFILES: Dict[str, VoiceProfile] = {
    "child": VoiceProfile("child", "Kiki", ["儿童", "孩子", "kid"]),
    "female": VoiceProfile("female", "Luna", ["女声", "woman", "girl"]),
    "female_warm": VoiceProfile("female_warm", "Rosie", ["温柔女声", "warm_female"]),
    "male": VoiceProfile("male", "Jasper", ["男声", "man", "boy"]),
    "male_deep": VoiceProfile("male_deep", "Hugo", ["低沉男声", "deep_male"]),
    "assistant": VoiceProfile("assistant", "Bella", ["默认", "助手", "default"]),
}

# edge-tts 音色映射: profile -> (中文字段, 英文字段)
# 微软神经语音，质量远高于 KittenTTS
EDGE_TTS_VOICE_MAP: Dict[str, Dict[str, str]] = {
    "child":       {"zh": "zh-CN-XiaoxuanNeural",  "en": "en-US-AriaNeural"},
    "female":      {"zh": "zh-CN-XiaoxiaoNeural",  "en": "en-US-JennyNeural"},
    "female_warm": {"zh": "zh-CN-XiaoyiNeural",    "en": "en-US-JennyNeural"},
    "male":        {"zh": "zh-CN-YunjianNeural",   "en": "en-US-GuyNeural"},
    "male_deep":   {"zh": "zh-CN-YunyangNeural",   "en": "en-US-DavisNeural"},
    "assistant":   {"zh": "zh-CN-XiaoxiaoNeural",  "en": "en-US-JennyNeural"},
}

_CHINESE_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")


def has_chinese(text: str) -> bool:
    return bool(_CHINESE_RE.search(text))


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=800)
    profile: Optional[str] = Field(default="child")
    voice: Optional[str] = None
    speed: float = Field(default=DEFAULT_SPEED, ge=0.5, le=2.0)
    clean_text: bool = True
    format: Literal["wav", "base64_json"] = "wav"


class SynthesizeJsonResponse(BaseModel):
    audio_base64: str
    sample_rate: int = 24000
    voice: str
    profile: str
    speed: float


app = FastAPI(title="Kitten TTS Service", version="0.1.0")

# ---------------------------------------------------------------------------
# 后台线程加载模型 -- 服务永远不阻塞
# ---------------------------------------------------------------------------

_tts: Optional[_KittenTTS] = None
_model_loading_error: Optional[str] = None
_model_loading_started = False


def _do_load() -> None:
    """实际执行模型加载（同步，可能阻塞）。"""
    global _tts, _model_loading_error
    try:
        if MODEL_DIR:
            # mock hf_hub_download 返回本地文件（kittentts.get_model 模块中的内联引用）
            import sys

            model_path = os.path.abspath(MODEL_DIR)

            def _local_hf_download(repo_id, filename, **kwargs):
                file_path = os.path.join(model_path, filename)
                if os.path.isfile(file_path):
                    return file_path
                raise FileNotFoundError(
                    f"Local model file not found: {file_path} "
                    f"(repo_id={repo_id}, filename={filename})"
                )

            model_module = sys.modules.get("kittentts.get_model")
            with _mock.patch.object(
                model_module, "hf_hub_download", _local_hf_download
            ):
                _tts = _KittenTTS(DEFAULT_MODEL)
        else:
            _tts = _KittenTTS(DEFAULT_MODEL)
    except Exception as exc:
        _model_loading_error = str(exc)


def _load_model_background() -> None:
    """在后台线程中加载 TTS 模型，超时后标记失败。"""
    global _model_loading_error
    try:
        t = Thread(target=_do_load, daemon=True)
        t.start()
        t.join(timeout=MODEL_LOAD_TIMEOUT)
        if t.is_alive():
            _model_loading_error = (
                f"Model download timed out after {MODEL_LOAD_TIMEOUT}s "
                f"(HuggingFace unreachable from this network)"
            )
    except Exception as exc:
        _model_loading_error = str(exc)


def ensure_model_loading() -> None:
    """确保模型加载已在后台启动（幂等，不阻塞）。"""
    global _model_loading_started
    if _model_loading_started:
        return
    if not _KITTENTTS_AVAILABLE:
        _model_loading_error = "kittentts package not installed"
        _model_loading_started = True
        return
    _model_loading_started = True
    t = Thread(target=_load_model_background, daemon=True)
    t.start()


# 应用启动时立即在后台触发模型加载
ensure_model_loading()


def _get_tts() -> _KittenTTS:
    """获取 TTS 实例；模型尚未加载就绪时抛出 503。"""
    if _tts is not None:
        return _tts
    if not _model_loading_started:
        ensure_model_loading()
    if _model_loading_error is not None:
        raise HTTPException(
            status_code=503,
            detail=f"TTS model loading failed: {_model_loading_error}",
        )
    raise HTTPException(
        status_code=503,
        detail="TTS model is still loading (HuggingFace download in progress)",
    )


# ---------------------------------------------------------------------------
# edge-tts 合成（异步）
# ---------------------------------------------------------------------------


async def _edge_tts_synthesize(
    text: str,
    voice: str,
    rate: str = "+0%",
) -> bytes:
    """调用 Microsoft edge-tts，返回 WAV 字节。"""
    communicate = _edge_tts.Communicate(text, voice=voice, rate=rate)
    audio_chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
    raw_mp3 = b"".join(audio_chunks)
    # edge-tts 默认输出 mp3，用内置 ffmpeg 转 wav
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i", "pipe:0",
        "-f", "wav",
        "-acodec", "pcm_s16le",
        "-ar", "24000",
        "-ac", "1",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate(input=raw_mp3)
    return stdout


def _pick_edge_tts_voice(profile: Optional[str], voice: Optional[str]) -> tuple[str, str, str]:
    """返回 (voice_name, profile_name, lang_hint)。"""
    profile_key = (profile or "child").strip().lower()
    for entry in VOICE_PROFILES.values():
        if profile_key == entry.name or profile_key in [a.lower() for a in entry.aliases]:
            profile_name = entry.name
            break
    else:
        profile_name = profile_key

    if voice:
        return voice, profile_name, "mixed"

    mapping = EDGE_TTS_VOICE_MAP.get(profile_key) or EDGE_TTS_VOICE_MAP["assistant"]
    # 如果没有中文，fallback 到英文音色
    return mapping["zh"], profile_name, "zh"


# ---------------------------------------------------------------------------
# Health / status
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tts_available": _tts is not None,
        "edge_tts_available": _EDGE_TTS_AVAILABLE,
        "model_loading": _model_loading_started,
        "model_loading_error": _model_loading_error,
        "model": DEFAULT_MODEL,
    }


# ---------------------------------------------------------------------------
# Voice resolution (KittenTTS 专用)
# ---------------------------------------------------------------------------


def resolve_voice(profile: Optional[str], voice: Optional[str]) -> tuple[str, str]:
    tts = _get_tts()
    available = set(tts.available_voices)
    if voice:
        if voice not in available:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported voice '{voice}'. available={sorted(available)}",
            )
        return voice, profile or "custom"

    profile_key = (profile or "child").strip().lower()
    chosen_profile = VOICE_PROFILES.get(profile_key)
    if chosen_profile:
        return chosen_profile.default_voice, chosen_profile.name

    for item in VOICE_PROFILES.values():
        if profile_key in [a.lower() for a in item.aliases]:
            return item.default_voice, item.name

    raise HTTPException(
        status_code=400,
        detail=(
            f"Unsupported profile '{profile}'. "
            f"supported={sorted(VOICE_PROFILES.keys())}"
        ),
    )


def pcm_float_to_wav_bytes(audio: np.ndarray, sample_rate: int = 24000) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@app.get("/v1/tts/voices")
def list_voices() -> dict:
    result: dict = {
        "profiles": {
            key: {"default_voice": item.default_voice, "aliases": item.aliases}
            for key, item in VOICE_PROFILES.items()
        },
    }
    if _KITTENTTS_AVAILABLE:
        result["kitten_voices"] = list(_tts.available_voices) if _tts else []
    if _EDGE_TTS_AVAILABLE:
        result["edge_tts_voices"] = EDGE_TTS_VOICE_MAP
        result["edge_tts_available"] = True
    return result


@app.post("/v1/tts/kitten")
async def synthesize(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text cannot be empty")

    text_has_chinese = has_chinese(text)

    # ── 优先使用 edge-tts（云端，中日英皆可） ──────────────────────
    if _EDGE_TTS_AVAILABLE:
        edge_voice, edge_profile, _ = _pick_edge_tts_voice(req.profile, req.voice)
        try:
            wav_bytes = await _edge_tts_synthesize(
                text=text,
                voice=edge_voice,
                rate=f"{int((req.speed - 1.0) * 100):+d}%" if req.speed != 1.0 else "+0%",
            )
            if not wav_bytes or len(wav_bytes) < 44:
                raise RuntimeError(f"empty WAV ({len(wav_bytes) if wav_bytes else 0} bytes)")

            if req.format == "base64_json":
                import base64
                payload = SynthesizeJsonResponse(
                    audio_base64=base64.b64encode(wav_bytes).decode("ascii"),
                    voice=edge_voice,
                    profile=edge_profile,
                    speed=req.speed,
                )
                return JSONResponse(content=payload.model_dump())

            headers = {
                "X-TTS-Voice": edge_voice,
                "X-TTS-Profile": edge_profile,
                "X-TTS-Sample-Rate": "24000",
                "X-TTS-Backend": "edge-tts",
            }
            return Response(content=wav_bytes, media_type="audio/wav", headers=headers)
        except Exception as exc:
            if text_has_chinese:
                raise HTTPException(
                    status_code=503,
                    detail=f"edge-tts failed for Chinese text (KittenTTS does not support Chinese): {exc}",
                ) from exc
            # English text: fall through to KittenTTS

    # ── KittenTTS 回退（仅英文） ────────────────────────────────────
    if text_has_chinese:
        raise HTTPException(
            status_code=503,
            detail="Chinese text requires edge-tts, which is not available. "
                   "Install it: pip install edge-tts",
        )

    tts = _get_tts()
    selected_voice, selected_profile = resolve_voice(req.profile, req.voice)
    try:
        audio = tts.generate(
            text=text,
            voice=selected_voice,
            speed=req.speed,
            clean_text=req.clean_text,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {exc}") from exc

    wav_bytes = pcm_float_to_wav_bytes(audio, sample_rate=24000)

    if req.format == "base64_json":
        import base64

        payload = SynthesizeJsonResponse(
            audio_base64=base64.b64encode(wav_bytes).decode("ascii"),
            voice=selected_voice,
            profile=selected_profile,
            speed=req.speed,
        )
        return JSONResponse(content=payload.model_dump())

    headers = {
        "X-TTS-Voice": selected_voice,
        "X-TTS-Profile": selected_profile,
        "X-TTS-Sample-Rate": "24000",
        "X-TTS-Backend": "kittentts",
    }
    return Response(content=wav_bytes, media_type="audio/wav", headers=headers)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=DEFAULT_PORT, log_level="info")
