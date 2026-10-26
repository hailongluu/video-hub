// Hàng đợi job (1 job/lần vì máy chỉ có 1 GPU), lưu data/jobs/<id>/job.json để khởi động lại không mất.
import fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { captions } from "./captions.mjs";
import { renderVideo } from "./render.mjs";
import { DATA, TTS_URL, internalUrl, ttsVoices } from "./config.mjs";

const JOBS = path.join(DATA, "jobs");
const ASPECTS = ["9:16", "16:9", "1:1"];
export const THEMES = ["midnight", "sunrise", "ocean", "forest", "paper"];
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

export async function validate(b) {
  if (!b || typeof b !== "object") throw new Error("body phải là JSON");
  const scenes = b.scenes;
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("cần scenes: [{text, heading?, bullets?, emoji?, image_url?}]");
  if (scenes.length > 30) throw new Error("tối đa 30 cảnh");
  const aspect = b.aspect ?? "9:16";
  if (!ASPECTS.includes(aspect)) throw new Error(`aspect phải là ${ASPECTS.join(", ")}`);
  const theme = b.theme ?? "midnight";
  if (!THEMES.includes(theme)) throw new Error(`theme phải là ${THEMES.join(", ")}`);
  const voices = await ttsVoices();
  const voice = b.voice ?? "Ngọc Huyền";
  if (!voices.some((v) => v.id === voice)) throw new Error(`không có giọng '${voice}' (xem list_voices)`);
  let chars = 0;
  const out = scenes.map((s, i) => {
    const text = str(s?.text, 800, `scenes[${i}].text`);
    if (!text) throw new Error(`scenes[${i}].text trống`);
    chars += text.length;
    const bullets = s.bullets == null ? undefined : s.bullets;
    if (bullets && (!Array.isArray(bullets) || bullets.length > 6 || bullets.some((x) => typeof x !== "string" || x.length > 80)))
      throw new Error(`scenes[${i}].bullets: tối đa 6 dòng, mỗi dòng ≤ 80 ký tự`);
    const image = str(s.image_url, 2000, `scenes[${i}].image_url`);
    if (image && !/^https?:\/\//.test(image)) throw new Error(`scenes[${i}].image_url phải là http(s)`);
    return { text, heading: str(s.heading, 120, `scenes[${i}].heading`), bullets, emoji: str(s.emoji, 16, `scenes[${i}].emoji`), image_url: image };
  });
  if (chars > 8000) throw new Error("tổng lời đọc quá 8000 ký tự");
  return {
    title: (str(b.title, 200, "title") || out[0].heading || out[0].text.slice(0, 60)).replace(/\*/g, ""),
    aspect, theme, voice,
    brand: str(b.brand, 60, "brand"),
    captions: b.captions !== false,
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

async function fetchImage(url, dest) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`tải ảnh ${url} lỗi HTTP ${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (!/^image\/(jpeg|png|webp|gif)/.test(type)) throw new Error(`${url} không phải ảnh (content-type ${type})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15e6) throw new Error(`ảnh ${url} lớn quá 15 MB`);
  await fs.writeFile(dest, buf);
}

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
  const scenes = [];
  for (const [i, sc] of s.scenes.entries()) {
    const wav = path.join(dir, `voice-${i}.wav`);
    const duration = await tts(sc.text, s.voice, wav);
    let image;
    if (sc.image_url) {
      const f = `img-${i}`;
      await fetchImage(sc.image_url, path.join(dir, f));
      image = internalUrl(j.id, f);
    }
    scenes.push({
      heading: sc.heading, text: sc.text, bullets: sc.bullets, emoji: sc.emoji, image,
      audio: internalUrl(j.id, `voice-${i}.wav`), duration, captions: captions(sc.text, duration),
    });
    await set({ progress: 0.3 * ((i + 1) / s.scenes.length) });
  }
  const ttsSec = (Date.now() - t0) / 1000;
  await set({ stage: "dựng hình" });
  const props = { title: s.title, aspect: s.aspect, theme: s.theme, brand: s.brand, showCaptions: s.captions, scenes };
  await fs.writeFile(path.join(dir, "props.json"), JSON.stringify(props, null, 2));
  let last = 0;
  const info = await renderVideo(props, dir, (p) => {
    if (p - last >= 0.05) { last = p; set({ progress: 0.3 + 0.68 * p }); }
  });
  await fs.rm(path.join(dir, "raw.mp4"), { force: true });
  const { size } = await fs.stat(path.join(dir, "video.mp4"));
  await set({
    status: "done", stage: "xong", progress: 1, finished: new Date().toISOString(),
    result: { ...info, bytes: size, ttsSec: +ttsSec.toFixed(1), totalSec: +((Date.now() - t0) / 1000).toFixed(1) },
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
