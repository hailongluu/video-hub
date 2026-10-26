"""Tạo các giọng "Long Lưu" theo phong cách từ refs/*.wav, lưu ~/Library/Application Support/VideoHub/custom_voices.json,
rồi đọc thử cùng một câu bằng từng giọng ra test/<tên>.wav."""
import json
from pathlib import Path

import numpy as np
from vieneu import Vieneu

lab = Path(__file__).resolve().parent
STYLES = {  # file mẫu → (tên giọng, mô tả)
    "thuyet-trinh": ("Long Lưu", "Nam · Bắc · Giọng thật của Long · Thuyết trình (mặc định)"),
    "truyen-cam-hung": ("Long Lưu · truyền cảm hứng", "Nam · Bắc · Giọng thật của Long · Truyền cảm hứng"),
    "tam-su": ("Long Lưu · tâm sự", "Nam · Bắc · Giọng thật của Long · Tâm sự, nhẹ nhàng"),
    "vlog": ("Long Lưu · vlog", "Nam · Bắc · Giọng thật của Long · Vlog"),
    "dan-chuong-trinh": ("Long Lưu · dẫn chương trình", "Nam · Bắc · Giọng thật của Long · Dẫn chương trình"),
}
tts = Vieneu()
out = {}
(lab / "test").mkdir(exist_ok=True)
for key, (name, desc) in STYLES.items():
    tts.add_voice(name, str(lab / "refs" / f"{key}.wav"), denoise=True, description=desc, gender="male")
    v = tts._preset_voices[name]
    out[name] = {"description": desc, "gender": "male",
                 "speaker_emb": [round(float(x), 6) for x in np.asarray(v["speaker_emb"]).reshape(-1)],
                 "codes": np.asarray(v["codes"], dtype=int).tolist() if v.get("codes") is not None else None}
    a = tts.infer(text="Xin chào, tôi là Long. Hôm nay tôi sẽ chia sẻ ba cách dùng trợ lý AI để làm việc nhanh gấp đôi.", voice=name)
    tts.save(a, str(lab / "test" / f"{key}.wav"))
    print("xong", name, flush=True)
cfg = Path.home() / "Library/Application Support/VideoHub/custom_voices.json"
cfg.write_text(json.dumps(out, ensure_ascii=False))
cfg.chmod(0o600)
print("lưu", cfg)
