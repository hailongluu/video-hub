import path from "node:path";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const DATA = path.resolve(process.env.VH_DATA || path.join(ROOT, "data"));
export const PORT = Number(process.env.VH_PORT || 8810);
export const HOST = process.env.VH_HOST || "0.0.0.0";
export const TTS_URL = process.env.VH_TTS_URL || "http://127.0.0.1:8811";
// Địa chỉ người ngoài dùng để tải file (IP Tailscale của Mac)
export const PUBLIC_URL = (process.env.VH_PUBLIC_URL || `http://100.72.113.110:${PORT}`).replace(/\/$/, "");

mkdirSync(path.join(DATA, "jobs"), { recursive: true });
mkdirSync(path.join(DATA, "tts"), { recursive: true });

// Token cho agent: data/token (0600), tạo lần đầu chạy
const TOKEN_FILE = path.join(DATA, "token");
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, `vh_${crypto.randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
export const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();

// Khoá ngẫu nhiên mỗi lần chạy cho đường /internal (Chrome của Remotion đọc file job), phòng khi có proxy cục bộ đứng trước
export const INTERNAL_KEY = crypto.randomBytes(16).toString("hex");
export const internalUrl = (id, file) => `http://127.0.0.1:${PORT}/internal/${INTERNAL_KEY}/${id}/${file}`;

let voiceCache;
export async function ttsVoices() {
  if (!voiceCache) {
    const r = await fetch(`${TTS_URL}/voices`);
    if (!r.ok) throw new Error("dịch vụ TTS chưa sẵn sàng");
    voiceCache = await r.json();
  }
  return voiceCache;
}
