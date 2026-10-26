"""Chọn đoạn mẫu 5–8 giây cho từng cụm giọng: chép lời bản ghi gốc (Whisper, mốc thời gian), ghép các câu liền nhau
thành cửa sổ 5–8 giây không có khoảng lặng dài, chấm theo độ giống tâm cụm, xuất refs/cum<N>.wav + .txt.
Chạy bằng python của tts/.venv; Whisper chạy bằng voice-lab/.venv qua subprocess (hai môi trường khác thư viện).
python pick_refs.py samples_dir
"""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from vieneu import Vieneu

d = Path(sys.argv[1]).resolve()
lab = Path(__file__).resolve().parent
refs = lab / "refs"
refs.mkdir(exist_ok=True)
rows = [json.loads(l) for l in (d / "samples.jsonl").read_text().splitlines() if l.strip()]
labels = json.loads((d / "clusters.json").read_text())["labels"]
by = defaultdict(list)
for r in rows:
    c = labels.get(r["clip"])
    if c:
        by[c].append(r)

tts = Vieneu()
TRANS = lab / "segments.py"
for c, rs in sorted(by.items()):
    E = np.array([r["emb"] for r in rs]); E /= np.linalg.norm(E, axis=1, keepdims=True)
    cent = E.mean(0); cent /= np.linalg.norm(cent)
    files = sorted({r["file"] for r in rs}, key=lambda f: -max(np.dot(cent, e) for r2, e in zip(rs, E) if r2["file"] == f))[:3]
    best = None
    for f in files:
        out = subprocess.run([str(lab / ".venv/bin/python"), str(TRANS), f], capture_output=True, text=True).stdout
        segs = [json.loads(l) for l in out.splitlines() if l.startswith("{")]
        for i in range(len(segs)):
            text, st, en = [], segs[i]["start"], segs[i]["start"]
            for j in range(i, len(segs)):
                if j > i and segs[j]["start"] - segs[j - 1]["end"] > 0.6:
                    break
                text.append(segs[j]["text"]); en = segs[j]["end"]
                if en - st > 8.5:
                    break
                if en - st >= 5:
                    tmp = refs / "tmp.wav"
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(st - 0.1, 0):.2f}", "-to", f"{en + 0.15:.2f}", "-i", f,
                                    "-ac", "1", "-ar", "24000", str(tmp)], check=True)
                    emb, _ = tts.encode_reference(str(tmp), denoise=True)
                    e = np.asarray(emb).reshape(-1); e /= np.linalg.norm(e)
                    score = float(e @ cent)
                    if not best or score > best[0]:
                        best = (score, f, st, en, " ".join(text))
    if best:
        score, f, st, en, text = best
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(st - 0.1, 0):.2f}", "-to", f"{en + 0.15:.2f}", "-i", f,
                        "-ac", "1", "-ar", "44100", str(refs / f"cum{c}.wav")], check=True)
        (refs / f"cum{c}.txt").write_text(text)
        print(json.dumps({"cum": c, "score": round(score, 3), "file": Path(f).name, "start": st, "end": en, "text": text}, ensure_ascii=False), flush=True)
    else:
        print(json.dumps({"cum": c, "error": "không có đoạn nói liền 5–8 giây"}), flush=True)
(refs / "tmp.wav").unlink(missing_ok=True)
