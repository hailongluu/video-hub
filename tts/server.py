"""Dịch vụ TTS tiếng Việt (VieNeu-TTS) giữ model trong RAM. Chỉ nghe 127.0.0.1; máy chủ Node gọi vào.

POST /tts {"text", "voice"?, "out"} → ghi WAV 48 kHz ra đường dẫn `out`, trả {"duration"}.
GET  /voices → [{"id", "label"}]
"""
import json
import os
import threading
import time
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from vieneu import Vieneu

_CFG = Path(os.environ.get("VH_CONFIG", Path.home() / "Library/Application Support/VideoHub")) / "config.json"
_cfg = json.loads(_CFG.read_text()) if _CFG.exists() else {}
# Cùng thư mục video với engine (server/config.mjs); TTS chỉ ghi file vào trong đó
OUT_ROOT = Path(os.environ.get("VH_DATA") or _cfg.get("dataDir") or Path.home() / "Movies/VideoHub").resolve()

app = FastAPI()
_lock = threading.Lock()  # model không an toàn khi gọi song song
_tts = None
_voices: dict[str, str] = {}
_voice_cache: dict[str, object] = {}


def tts():
    global _tts
    if _tts is None:
        t = time.time()
        _tts = Vieneu()
        for label, vid in _tts.list_preset_voices():
            _voices[vid] = label.replace("⭐", "").strip()
        print(f"VieNeu nạp xong sau {time.time() - t:.1f}s, {len(_voices)} giọng", flush=True)
    return _tts


class Req(BaseModel):
    text: str
    voice: str | None = None
    out: str
    temperature: float = 1.0


@app.on_event("startup")
def _warm():
    with _lock:
        tts()


@app.get("/health")
def health():
    return {"ok": _tts is not None}


@app.get("/voices")
def voices():
    tts()
    return [{"id": k, "label": v} for k, v in _voices.items()]


@app.post("/tts")
def synth(r: Req):
    text = r.text.strip()
    if not text:
        raise HTTPException(400, "text rỗng")
    if len(text) > 5000:
        raise HTTPException(400, "text quá 5000 ký tự")
    out = Path(r.out).resolve()
    if OUT_ROOT not in out.parents:
        raise HTTPException(400, "out phải nằm trong thư mục data")
    with _lock:
        m = tts()
        kw = {}
        if r.voice:
            if r.voice not in _voices:
                raise HTTPException(400, f"không có giọng '{r.voice}'")
            if r.voice not in _voice_cache:
                _voice_cache[r.voice] = m.get_preset_voice(r.voice)
            kw["voice"] = _voice_cache[r.voice]
        t = time.time()
        audio = m.infer(text=text, temperature=r.temperature, **kw)
        out.parent.mkdir(parents=True, exist_ok=True)
        m.save(audio, str(out))
    info = sf.info(str(out))
    return {"duration": info.duration, "seconds": round(time.time() - t, 2)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VH_TTS_PORT", "8811")))
