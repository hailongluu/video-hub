// Hàng đợi job (1 job/lần vì máy chỉ có 1 GPU), lưu data/jobs/<id>/job.json để khởi động lại không mất.
import fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { captions } from "./captions.mjs";
import { renderVideo } from "./render.mjs";
import { mixAudio } from "./audio.mjs";
import { checkRef, listMusic, resolveMedia } from "./media.mjs";
import { DATA, TTS_URL, internalUrl, ttsVoices } from "./config.mjs";

const JOBS = path.join(DATA, "jobs");
const ASPECTS = ["9:16", "16:9", "1:1"];
export const THEMES = ["midnight", "sunrise", "ocean", "forest", "paper"];
export const TEMPLATES = ["explainer", "kinetic"];
export const KINETIC_STYLES = ["vox", "kinetic"];
export const KINDS = ["hook", "item", "warn", "risk", "takeaway", "cta"];
const KINETIC_PAD = 0.35; // giây nghỉ sau lời mỗi cảnh, khớp PAD trong remotion/Kinetic.tsx
const KINETIC_FPS = 30; // khớp KFPS trong remotion/Kinetic.tsx
const KINETIC_MUSIC = { vox: "motions", kinetic: "screen-saver" }; // nhạc mặc định theo phong cách (nếu có trong thư viện)
const jobs = new Map();
const queue = [];
let busy = false;

for (const id of existsSync(JOBS) ? readdirSync(JOBS) : []) {
  try {
    const j = JSON.parse(readFileSync(path.join(JOBS, id, "job.json"), "utf8"));
    if (j.status === "queued" || j.status === "running") Object.assign(j, { status: "failed", error: "máy chủ khởi động lại giữa chừng" });
    jobs.set(id, j);
  } catch {}
}

const save = (j) => fs.writeFile(path.join(JOBS, j.id, "job.json"), JSON.stringify(j, null, 2));
const str = (v, max, name) => {
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw new Error(`${name} phải là chuỗi`);
  if (v.length > max) throw new Error(`${name} dài quá ${max} ký tự`);
  return v.trim();
};

const strList = (v, maxN, maxLen, name) => {
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.length > maxN || v.some((x) => typeof x !== "string" || x.length > maxLen))
    throw new Error(`${name}: tối đa ${maxN} dòng, mỗi dòng ≤ ${maxLen} ký tự`);
  return v;
};

function kineticScene(s, i) {
  const n = `scenes[${i}]`;
  if (!KINDS.includes(s.kind)) throw new Error(`${n}.kind phải là ${KINDS.join(", ")} (mẫu kinetic)`);
  let visual;
  if (s.visual != null) {
    if (typeof s.visual !== "object" || Array.isArray(s.visual)) throw new Error(`${n}.visual phải là object`);
    if (JSON.stringify(s.visual).length > 4000) throw new Error(`${n}.visual quá lớn`);
    visual = s.visual;
  }
  const num = s.num == null ? undefined : Number(s.num);
  if (num != null && !(Number.isInteger(num) && num >= 0 && num < 100)) throw new Error(`${n}.num phải là số nguyên 0–99`);
  return {
    kind: s.kind, kicker: str(s.kicker, 60, `${n}.kicker`), lines: strList(s.lines, 3, 40, `${n}.lines`), num,
    title: str(s.title, 120, `${n}.title`), sub: str(s.sub, 160, `${n}.sub`), prompt: str(s.prompt, 300, `${n}.prompt`), visual,
  };
}

export async function validate(b) {
  if (!b || typeof b !== "object") throw new Error("body phải là JSON");
  const template = b.template ?? "explainer";
  if (!TEMPLATES.includes(template)) throw new Error(`template phải là ${TEMPLATES.join(", ")}`);
  const scenes = b.scenes;
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("cần scenes: [{text, ...}]");
  if (scenes.length > 30) throw new Error("tối đa 30 cảnh");
  const aspect = template === "kinetic" ? "9:16" : b.aspect ?? "9:16";
  if (!ASPECTS.includes(aspect)) throw new Error(`aspect phải là ${ASPECTS.join(", ")}`);
  const theme = b.theme ?? "midnight";
  if (!THEMES.includes(theme)) throw new Error(`theme phải là ${THEMES.join(", ")}`);
  const style = b.style ?? "vox";
  if (template === "kinetic" && !KINETIC_STYLES.includes(style)) throw new Error(`style phải là ${KINETIC_STYLES.join(", ")}`);
  const voices = await ttsVoices();
  const voice = b.voice ?? "Ngọc Huyền";
  if (!voices.some((v) => v.id === voice)) throw new Error(`không có giọng '${voice}' (xem list_voices)`);
  let music = b.music;
  if (music === undefined && template === "kinetic" && listMusic().includes(KINETIC_MUSIC[style])) music = KINETIC_MUSIC[style];
  checkRef(music, "audio", "music");
  let chars = 0;
  const out = scenes.map((s, i) => {
    const text = str(s?.text, 800, `scenes[${i}].text`);
    if (!text) throw new Error(`scenes[${i}].text trống`);
    chars += text.length;
    if (template === "kinetic") return { text, ...kineticScene(s, i) };
    const image = str(s.image_url, 2000, `scenes[${i}].image_url`);
    checkRef(image, "image", `scenes[${i}].image_url`);
    return { text, heading: str(s.heading, 120, `scenes[${i}].heading`), bullets: strList(s.bullets, 6, 80, `scenes[${i}].bullets`),
      emoji: str(s.emoji, 16, `scenes[${i}].emoji`), image_url: image };
  });
  if (chars > 8000) throw new Error("tổng lời đọc quá 8000 ký tự");
  const first = out[0];
  return {
    template,
    title: (str(b.title, 200, "title") || first.heading || first.title || first.text.slice(0, 60)).replace(/\*/g, ""),
    aspect, theme, style: template === "kinetic" ? style : undefined, voice,
    brand: str(b.brand, 60, "brand"),
    captions: b.captions !== false,
    music: music && music !== "none" ? music : undefined,
    scenes: out,
  };
}

export async function createJob(spec, owner) {
  const id = crypto.randomBytes(6).toString("hex");
  const key = crypto.randomBytes(12).toString("hex"); // khoá trong link tải, để chia link không cần token
  const j = { id, key, owner, status: "queued", progress: 0, stage: "chờ", created: new Date().toISOString(), spec };
  await fs.mkdir(path.join(JOBS, id), { recursive: true });
  await save(j);
  jobs.set(id, j);
  queue.push(id);
  pump();
  return j;
}

export const getJob = (id) => jobs.get(id);
export const listJobs = (n = 20) => [...jobs.values()].sort((a, b) => b.created.localeCompare(a.created)).slice(0, n);
export const queuePos = (id) => queue.indexOf(id);
export const jobDir = (id) => path.join(JOBS, id);

export async function tts(text, voice, out) {
  const r = await fetch(`${TTS_URL}/tts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice, out }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`TTS lỗi: ${body.detail || r.status}`);
  return body.duration;
}

async function runJob(j) {
  const dir = jobDir(j.id);
  const t0 = Date.now();
  const set = async (o) => { Object.assign(j, o); await save(j); };
  await set({ status: "running", stage: "đọc giọng", started: new Date().toISOString() });
  const s = j.spec;
  const kinetic = s.template === "kinetic";
  const scenes = [];
  for (const [i, sc] of s.scenes.entries()) {
    const wav = path.join(dir, `voice-${i}.wav`);
    const duration = await tts(sc.text, s.voice, wav);
    const caps = captions(sc.text, duration);
    if (kinetic) {
      const { text, ...rest } = sc;
      scenes.push({ ...rest, duration, captions: caps });
    } else {
      let image;
      if (sc.image_url) {
        const src = await resolveMedia(sc.image_url, "image", dir, `img-${i}`);
        const f = `img-${i}${path.extname(src)}`;
        if (path.dirname(src) !== dir) await fs.copyFile(src, path.join(dir, f));
        else await fs.rename(src, path.join(dir, f));
        image = internalUrl(j.id, f);
      }
      scenes.push({
        heading: sc.heading, text: sc.text, bullets: sc.bullets, emoji: sc.emoji, image,
        audio: internalUrl(j.id, `voice-${i}.wav`), duration, captions: caps,
      });
    }
    await set({ progress: 0.25 * ((i + 1) / s.scenes.length) });
  }
  const music = s.music ? await resolveMedia(s.music, "audio", dir, "music") : null;
  const ttsSec = (Date.now() - t0) / 1000;
  await set({ stage: "dựng hình" });
  const props = kinetic
    ? { style: s.style, brand: s.brand, scenes }
    : { title: s.title, aspect: s.aspect, theme: s.theme, brand: s.brand, showCaptions: s.captions, scenes };
  await fs.writeFile(path.join(dir, "props.json"), JSON.stringify(props, null, 2));
  let last = 0;
  const info = await renderVideo(props, dir, (p) => {
    if (p - last >= 0.05) { last = p; set({ progress: 0.25 + 0.65 * p }); }
  }, { id: kinetic ? "Kinetic" : "Explainer", muted: kinetic });
  await set({ stage: "trộn âm thanh", progress: 0.92 });
  const out = path.join(dir, "video.mp4");
  if (kinetic) {
    // giọng đặt đúng đầu mỗi cảnh (cảnh Kinetic cắt cứng, không chồng nhau), tiếng nhấn ở mỗi lần cắt
    const starts = [];
    let acc = 0;
    for (const sc of scenes) { starts.push(acc); acc += Math.ceil((sc.duration + KINETIC_PAD) * KINETIC_FPS) / KINETIC_FPS; }
    await mixAudio({ video: info.raw, videoVoice: false, voices: scenes.map((_, i) => ({ file: path.join(dir, `voice-${i}.wav`), start: starts[i] })),
      music, hits: starts.slice(1), total: info.seconds, out });
  } else {
    await mixAudio({ video: info.raw, videoVoice: true, music, musicVolume: 0.25, total: info.seconds, out });
  }
  await fs.rm(info.raw, { force: true });
  const { raw, ...result } = info;
  const { size } = await fs.stat(out);
  await set({
    status: "done", stage: "xong", progress: 1, finished: new Date().toISOString(),
    result: { ...result, bytes: size, ttsSec: +ttsSec.toFixed(1), totalSec: +((Date.now() - t0) / 1000).toFixed(1) },
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const j = jobs.get(queue.shift());
    try {
      await runJob(j);
    } catch (e) {
      console.error(`job ${j.id} lỗi:`, e);
      Object.assign(j, { status: "failed", error: String(e.message || e).slice(0, 500), finished: new Date().toISOString() });
      await save(j);
    }
  }
  busy = false;
}
