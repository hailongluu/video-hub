"""Cắt mẫu 8 giây rải đều trong các bản ghi, tính vân giọng (x-vector 192 chiều của VieNeu), lưu để gom cụm người nói.
Chạy bằng python của tts/.venv (có vieneu): python sample_speakers.py out_dir file1 file2 ...
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from vieneu import Vieneu

out = Path(sys.argv[1])
(out / "clips").mkdir(parents=True, exist_ok=True)
files = sys.argv[2:]
PER_FILE = 4
LEN = 8.0

tts = Vieneu()
rows = []
for fi, f in enumerate(files):
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
                               capture_output=True, text=True).stdout or 0)
    if dur < 3:
        continue
    n = 1 if dur < 20 else 2 if dur < 120 else PER_FILE
    ln = min(LEN, dur)
    for k in range(n):
        t = max(0.0, dur * (k + 0.5) / n - ln / 2)
        clip = out / "clips" / f"f{fi:02d}_{k}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.1f}", "-t", str(ln), "-i", f,
                        "-ac", "1", "-ar", "24000", str(clip)], check=True)
        wav, sr = sf.read(clip)
        rms = float(np.sqrt(np.mean(wav ** 2))) if len(wav) else 0
        if rms < 0.01:  # gần như im lặng
            clip.unlink()
            continue
        try:
            emb, _ = tts.encode_reference(str(clip), denoise=True)
        except Exception as e:
            print("bỏ", clip, e, flush=True)
            continue
        row = {"clip": clip.name, "file": f, "t": round(t, 1), "rms": round(rms, 4),
               "emb": [float(x) for x in np.asarray(emb).reshape(-1)]}
        rows.append(row)
        with open(out / "samples.jsonl", "a") as fh:  # ghi dần để xem được khi đang chạy
            fh.write(json.dumps(row) + "\n")
    print(f"{fi + 1}/{len(files)} {Path(f).name}: {sum(r['file'] == f for r in rows)} mẫu", flush=True)

(out / "samples.json").write_text(json.dumps(rows))
print("xong", len(rows), "mẫu")
