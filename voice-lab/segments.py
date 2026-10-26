"""In từng câu (JSON mỗi dòng: start, end, text) của một file âm thanh bằng Whisper large-v3-turbo (CPU, int8)."""
import json
import sys

from faster_whisper import WhisperModel

m = WhisperModel("mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8")
segs, _ = m.transcribe(sys.argv[1], language="vi", vad_filter=True)
for s in segs:
    if s.no_speech_prob < 0.5 and s.avg_logprob > -0.8:  # bỏ câu Whisper đoán bừa (nhạc, tiếng ồn)
        print(json.dumps({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}, ensure_ascii=False), flush=True)
