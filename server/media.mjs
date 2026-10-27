// File agent tải lên (ảnh nền, nhạc nền) và thư viện nhạc có sẵn. Tham chiếu trong create_video:
//   "media:<id>"  file đã tải lên bằng upload_media
//   "<tên nhạc>"  nhạc trong thư viện <nơi lưu>/assets/music/<tên>.m4a (list_music)
//   "https://..." nhà máy tự tải về
import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA } from "./config.mjs";

const run = promisify(execFile);
export const MEDIA = path.join(DATA, "media");
export const MUSIC = path.join(DATA, "assets", "music");
const MAX_BYTES = 10e6;
const MAX_AUDIO_SEC = 600;

// Nhận diện theo byte đầu, không tin đuôi tên file
function sniff(b) {
  const s = (a, z) => b.subarray(a, z).toString("latin1");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", ext: "jpg" };
  if (s(0, 8) === "\x89PNG\r\n\x1a\n") return { kind: "image", ext: "png" };
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return { kind: "image", ext: "webp" };
  if (s(0, 4) === "GIF8") return { kind: "image", ext: "gif" };
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return { kind: "audio", ext: "wav" };
  if (s(4, 8) === "ftyp" && /^(M4A |M4B |mp42|isom|iso2|dash)/.test(s(8, 12))) return { kind: "audio", ext: "m4a" };
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: "audio", ext: "mp3" };
  if (s(0, 4) === "OggS") return { kind: "audio", ext: "ogg" };
  return null;
}

async function audioSeconds(file) {
  // chỉ cho ffprobe đọc file cục bộ (chặn playlist/concat trỏ ra ngoài)
  const { stdout } = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration",
    "-of", "csv=p=0", file]);
  const d = parseFloat(stdout);
  if (!(d > 0)) throw new Error("file âm thanh hỏng hoặc không đọc được");
  return d;
}

async function store(buf, name) {
  if (buf.length > MAX_BYTES) throw new Error(`file lớn quá ${MAX_BYTES / 1e6} MB`);
  const t = sniff(buf);
  if (!t) throw new Error("chỉ nhận ảnh jpg/png/webp/gif hoặc nhạc m4a/mp3/wav/ogg");
  await fs.mkdir(MEDIA, { recursive: true });
  const id = crypto.randomBytes(8).toString("hex");
  const file = path.join(MEDIA, `${id}.${t.ext}`);
  await fs.writeFile(file, buf);
  const meta = { id, kind: t.kind, ext: t.ext, name: String(name || "").slice(0, 120), bytes: buf.length, created: new Date().toISOString() };
  try {
    if (t.kind === "audio") {
      meta.seconds = +(await audioSeconds(file)).toFixed(2);
      if (meta.seconds > MAX_AUDIO_SEC) throw new Error(`nhạc dài quá ${MAX_AUDIO_SEC / 60} phút`);
    }
  } catch (e) {
    await fs.rm(file, { force: true });
    throw e;
  }
  await fs.writeFile(path.join(MEDIA, `${id}.json`), JSON.stringify(meta));
  return { media_id: `media:${id}`, ...meta };
}

export async function uploadBase64(name, data) {
  if (typeof data !== "string" || !data) throw new Error("thiếu data_base64");
  const b64 = data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (b64.length > MAX_BYTES * 1.37) throw new Error(`file lớn quá ${MAX_BYTES / 1e6} MB`);
  return store(Buffer.from(b64, "base64"), name);
}

export async function uploadFromUrl(url) {
  if (!/^https?:\/\//.test(url)) throw new Error("url phải là http(s)");
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`tải ${url} lỗi HTTP ${r.status}`);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error(`file lớn quá ${MAX_BYTES / 1e6} MB`);
  return store(Buffer.from(await r.arrayBuffer()), url.split("/").pop());
}

export function listMusic() {
  if (!existsSync(MUSIC)) return [];
  return readdirSync(MUSIC).filter((f) => /\.(m4a|mp3|wav|ogg)$/i.test(f)).map((f) => f.replace(/\.[^.]+$/, "")).sort();
}

// Trả đường dẫn file cục bộ cho một tham chiếu ảnh/nhạc; tải http(s) vào thư mục job
export async function resolveMedia(ref, kind, jobDir, label) {
  if (!ref || ref === "none") return null;
  const m = /^media:([0-9a-f]{16})$/.exec(ref);
  if (m) {
    const meta = JSON.parse(await fs.readFile(path.join(MEDIA, `${m[1]}.json`), "utf8").catch(() => "null"));
    if (!meta) throw new Error(`không có ${ref} (tải lên bằng upload_media trước)`);
    if (meta.kind !== kind) throw new Error(`${ref} là ${meta.kind === "image" ? "ảnh" : "nhạc"}, không dùng làm ${kind === "image" ? "ảnh" : "nhạc"}`);
    return path.join(MEDIA, `${meta.id}.${meta.ext}`);
  }
  if (/^https?:\/\//.test(ref)) {
    const meta = await uploadFromUrl(ref);
    if (meta.kind !== kind) throw new Error(`${ref} không phải ${kind === "image" ? "ảnh" : "nhạc"}`);
    const dest = path.join(jobDir, `${label}.${meta.ext}`);
    await fs.rename(path.join(MEDIA, `${meta.id}.${meta.ext}`), dest);
    await fs.rm(path.join(MEDIA, `${meta.id}.json`), { force: true });
    return dest;
  }
  if (kind === "audio" && listMusic().includes(ref)) {
    const f = readdirSync(MUSIC).find((x) => x.replace(/\.[^.]+$/, "") === ref);
    return path.join(MUSIC, f);
  }
  throw new Error(kind === "audio" ? `không có nhạc '${ref}' (xem list_music, hoặc dùng media:<id> / https://)` : `ảnh '${ref}' phải là media:<id> hoặc https://`);
}

// Kiểm tra sớm lúc nhận job (lỗi báo ngay cho agent, không đợi tới lúc dựng)
export function checkRef(ref, kind, name) {
  if (ref == null || ref === "" || ref === "none") return;
  if (typeof ref !== "string" || ref.length > 2000) throw new Error(`${name} không hợp lệ`);
  if (/^media:[0-9a-f]{16}$/.test(ref)) {
    if (!existsSync(path.join(MEDIA, `${ref.slice(6)}.json`))) throw new Error(`${name}: không có ${ref} (tải lên bằng upload_media trước)`);
    return;
  }
  if (/^https?:\/\//.test(ref)) return;
  if (kind === "audio" && listMusic().includes(ref)) return;
  throw new Error(kind === "audio" ? `${name}: không có nhạc '${ref}' (list_music)` : `${name} phải là media:<id> hoặc https://`);
}
