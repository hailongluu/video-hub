"""Gom cụm người nói từ samples.jsonl (vân giọng 192 chiều), in các cụm lớn và ghép 3 đoạn tiêu biểu mỗi cụm để nghe.
python cluster.py samples_dir [ngưỡng cosine, mặc định 0.55]
"""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

d = Path(sys.argv[1]).resolve()
TH = float(sys.argv[2]) if len(sys.argv) > 2 else 0.55
rows = [json.loads(l) for l in (d / "samples.jsonl").read_text().splitlines() if l.strip()]
E = np.array([r["emb"] for r in rows], dtype=np.float32)
E /= np.linalg.norm(E, axis=1, keepdims=True)

# gom cụm tham lam theo tâm cụm: mẫu vào cụm có tâm gần nhất nếu cosine ≥ ngưỡng, không thì mở cụm mới; lặp 3 vòng
labels = np.full(len(rows), -1)
cents: list[np.ndarray] = []
for _ in range(3):
    for i, e in enumerate(E):
        if cents:
            sims = np.array([c @ e for c in cents])
            j = int(sims.argmax())
            if sims[j] >= TH:
                labels[i] = j
                continue
        cents.append(e.copy())
        labels[i] = len(cents) - 1
    new = []
    for j in range(len(cents)):
        m = E[labels == j]
        if len(m):
            c = m.mean(0)
            new.append(c / np.linalg.norm(c))
    cents = new
    labels[:] = -1
for i, e in enumerate(E):
    labels[i] = int(np.argmax([c @ e for c in cents]))

groups = defaultdict(list)
for i, l in enumerate(labels):
    groups[int(l)].append(i)
order = sorted(groups, key=lambda g: -len({rows[i]["file"] for i in groups[g]}))
prev = d / "preview"
prev.mkdir(exist_ok=True)
summary = []
for rank, g in enumerate(order[:6]):
    idx = groups[g]
    files = {rows[i]["file"] for i in idx}
    c = cents[g]
    best = sorted(idx, key=lambda i: -(E[i] @ c))[:3]
    lst = prev / f"cum{rank + 1}.txt"
    lst.write_text("".join(f"file '{(d / 'clips' / rows[i]['clip']).as_posix()}'\n" for i in best))
    outf = prev / f"cum{rank + 1}.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:a", "aac", "-b:a", "128k", str(outf)], check=True)
    tight = float(np.mean([E[i] @ c for i in idx]))
    summary.append({"cum": rank + 1, "mau": len(idx), "so_ban_ghi": len(files), "do_chat": round(tight, 2),
                    "vi_du": [f"{Path(rows[i]['file']).name}@{rows[i]['t']}s" for i in best]})
    print(summary[-1])
(d / "clusters.json").write_text(json.dumps({"threshold": TH, "summary": summary,
                                             "labels": {rows[i]["clip"]: order.index(int(l)) + 1 if int(l) in order else None
                                                        for i, l in enumerate(labels)}}, ensure_ascii=False, indent=1))
