// Chia lời đọc thành cụm phụ đề 2–6 từ, chia thời gian theo số âm tiết (tiếng Việt: mỗi từ ~ một âm tiết).
const MAX_WORDS = 6;

export function chunk(text) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const stop = /[.,!?;:…]$/.test(w);
    if (cur.length >= MAX_WORDS || (stop && cur.length >= 2)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    if (cur.length === 1 && out.length) out[out.length - 1].push(...cur);
    else out.push(cur);
  }
  return out;
}

// Trọng số mỗi từ: 1 + dấu câu cuối từ tính như khoảng nghỉ
const weight = (w) => 1 + (/[.!?…]$/.test(w) ? 0.8 : /[,;:]$/.test(w) ? 0.4 : 0);

export function captions(text, duration, lead = 0.08, trail = 0.12) {
  const groups = chunk(text);
  const total = groups.flat().reduce((n, w) => n + weight(w), 0) || 1;
  const span = Math.max(duration - lead - trail, 0.1);
  let t = lead;
  return groups.map((g) => {
    const d = (g.reduce((n, w) => n + weight(w), 0) / total) * span;
    const c = { text: g.join(" "), start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return c;
  });
}
