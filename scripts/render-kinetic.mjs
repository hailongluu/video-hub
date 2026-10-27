// Dựng một video "Kinetic" từ file kịch bản: giọng VieNeu từng cảnh → phụ đề → Remotion (GPU) → trộn giọng + nhạc + tiếng nhấn.
// Dùng: node scripts/render-kinetic.mjs <kich-ban.json> <vox|kinetic> [nhac.m4a]
// Cần dịch vụ giọng đang bật (app Video Hub → Bật nhà máy). Kết quả ở ~/Movies/VideoHub/kinetic/<tên>-<phong cách>/.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { captions } from "../server/captions.mjs";
import { mixAudio } from "../server/audio.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const TTS = process.env.VH_TTS_URL || "http://127.0.0.1:8811";
const FPS = 30, PAD = 0.35;

const [specFile, style = "vox", musicArg] = process.argv.slice(2);
if (!specFile) { console.error("Dùng: node scripts/render-kinetic.mjs <kich-ban.json> <vox|kinetic> [nhac.m4a]"); process.exit(64); }
const spec = JSON.parse(await fs.readFile(specFile, "utf8"));
const name = path.basename(specFile, ".json");
const out = path.join(process.env.VH_DATA || path.join(os.homedir(), "Movies/VideoHub"), "kinetic", `${name}-${style}`);
await fs.mkdir(out, { recursive: true });
const music = musicArg || path.join(os.homedir(), "Movies/VideoHub/assets/music", style === "vox" ? "motions.m4a" : "screen-saver.m4a");
const t0 = Date.now();

// 1. giọng từng cảnh
const scenes = [];
for (const [i, s] of spec.scenes.entries()) {
  const wav = path.join(out, `voice-${i}.wav`);
  const r = await fetch(`${TTS}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: s.voice, voice: spec.voice, out: wav }) });
  const b = await r.json();
  if (!r.ok) throw new Error(`TTS cảnh ${i}: ${b.detail || r.status}`);
  const { voice, ...rest } = s;
  scenes.push({ ...rest, duration: b.duration, captions: captions(voice, b.duration) });
  console.log(`giọng cảnh ${i + 1}/${spec.scenes.length}: ${b.duration.toFixed(2)}s`);
}
const props = { style, brand: spec.brand, scenes };
await fs.writeFile(path.join(out, "props.json"), JSON.stringify(props, null, 2));

// 2. hình (GPU qua ANGLE/Metal)
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "remotion/index.ts") });
const chromiumOptions = { gl: process.env.VH_GL || "angle" };
const composition = await selectComposition({ serveUrl, id: "Kinetic", inputProps: props, chromiumOptions });
const silent = path.join(out, "silent.mp4");
let last = 0;
if (process.env.REUSE_VIDEO !== '1' || !(await fs.stat(silent).catch(() => null))) await renderMedia({ serveUrl, composition, inputProps: props, codec: "h264", outputLocation: silent, chromiumOptions, muted: true,
  concurrency: Math.max(2, Math.floor(os.cpus().length / 2)), hardwareAcceleration: "if-possible", videoBitrate: "10M",
  onProgress: ({ progress }) => { if (progress - last >= 0.1) { last = progress; console.log(`dựng hình ${Math.round(progress * 100)}%`); } } });

// 3. âm thanh: giọng đặt đúng đầu mỗi cảnh, nhạc nền tự nhỏ khi có giọng, tiếng "tách" giấy/whoosh ở mỗi lần cắt cảnh
const starts = [];
let acc = 0;
for (const s of scenes) { starts.push(acc); acc += Math.ceil((s.duration + PAD) * FPS) / FPS; }
const total = acc;
const final = path.join(out, "video.mp4");
await mixAudio({ video: silent, videoVoice: false, voices: scenes.map((_, i) => ({ file: path.join(out, `voice-${i}.wav`), start: starts[i] })),
  music, hits: starts.slice(1), total, out: final });
await renderStill({ serveUrl, composition, inputProps: props, output: path.join(out, "poster.jpg"), frame: 40, imageFormat: "jpeg", chromiumOptions });
// bảng kiểm: 1 khung giữa mỗi cảnh
const mids = starts.map((s, i) => (s + (scenes[i].duration + PAD) * 0.72).toFixed(2));
await run("ffmpeg", ["-y", "-v", "error", "-i", final, "-vf", `select='${mids.map((t) => `lt(prev_t\\,${t})*gte(t\\,${t})`).join("+")}',scale=270:-1,tile=${mids.length}x1`, "-vsync", "vfr", "-frames:v", "1", path.join(out, "sheet.jpg")]);
console.log(JSON.stringify({ video: final, seconds: +total.toFixed(2), scenes: n, totalSec: +((Date.now() - t0) / 1000).toFixed(1) }));
