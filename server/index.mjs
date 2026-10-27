// LL Video Hub: REST API + MCP trên một cổng. Chỉ nhận kết nối từ máy này và tailnet (100.64.0.0/10).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, HOST, INTERNAL_KEY, PORT, TOKEN, ttsVoices } from "./config.mjs";
import { createJob, getJob, jobDir, listJobs, validate } from "./jobs.mjs";
import { publicJob, speak } from "./api.mjs";
import { listMusic, uploadBase64, uploadFromUrl } from "./media.mjs";
import { handleMcp } from "./mcp.mjs";
import { ensureBundle } from "./render.mjs";

const TYPES = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".wav": "audio/wav", ".png": "image/png", ".webp": "image/webp" };

const ipOf = (req) => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const isLocal = (ip) => ip === "127.0.0.1" || ip === "::1";
const isTailnet = (ip) => {
  const m = /^100\.(\d+)\./.exec(ip);
  return m && +m[1] >= 64 && +m[1] <= 127;
};
const authed = (req) => {
  const got = Buffer.from((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

async function readBody(req, limit = 2e6) {
  let n = 0;
  const chunks = [];
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Object.assign(new Error("body quá lớn"), { code: 413 });
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : undefined;
}

// Gửi file có hỗ trợ Range (trình phát video tua được)
function sendFile(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { return send(res, 404, { error: "không có file" }); }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (range) {
    const start = range[1] ? +range[1] : 0;
    const end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${st.size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes" });
  fs.createReadStream(file).pipe(res);
}

const SAFE = /^[A-Za-z0-9._-]+$/;
const UPLOAD_LIMIT = 16e6; // /mcp và /api/media: file 10 MB mã hoá base64

async function route(req, res) {
  const ip = ipOf(req);
  if (!isLocal(ip) && !isTailnet(ip)) return send(res, 403, { error: "chỉ mở trong tailnet" });
  const url = new URL(req.url, "http://x");
  const p = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/health") {
    const recent = listJobs(100);
    const count = (st) => recent.filter((j) => j.status === st).length;
    return send(res, 200, { ok: true, running: count("running"), queue: count("queued"), done: count("done") });
  }

  // File cho Chrome của Remotion đọc khi dựng: chỉ từ chính máy này
  if (p[0] === "internal" && p.length === 4) {
    if (!isLocal(ip) || p[1] !== INTERNAL_KEY || !SAFE.test(p[2]) || !SAFE.test(p[3])) return send(res, 403, { error: "cấm" });
    return sendFile(req, res, path.join(jobDir(p[2]), p[3]));
  }
  // Link tải: /files/<id>/<key>/<file> — khoá trong link thay cho token để chia sẻ được
  if (p[0] === "files" && p.length === 4 && req.method === "GET") {
    const j = getJob(p[1]);
    if (!j || j.key !== p[2] || !["video.mp4", "poster.jpg"].includes(p[3])) return send(res, 404, { error: "không có file" });
    return sendFile(req, res, path.join(jobDir(j.id), p[3]));
  }
  if (p[0] === "tts" && p.length === 2 && /^[0-9a-f]{24}\.wav$/.test(p[1])) return sendFile(req, res, path.join(DATA, "tts", p[1]));

  if (!authed(req)) return send(res, 401, { error: "cần header Authorization: Bearer <token>" });

  if (url.pathname === "/mcp") {
    if (req.method !== "POST") return send(res, 405, { error: "MCP chỉ nhận POST (không phiên)" });
    return handleMcp(req, res, await readBody(req, UPLOAD_LIMIT));
  }
  if (url.pathname === "/api/voices") return send(res, 200, { voices: await ttsVoices() });
  if (url.pathname === "/api/videos" && req.method === "POST") {
    const j = await createJob(await validate(await readBody(req)), `api:${ip}`);
    return send(res, 202, publicJob(j));
  }
  if (url.pathname === "/api/videos" && req.method === "GET") return send(res, 200, { videos: listJobs(50).map(publicJob) });
  if (p[0] === "api" && p[1] === "videos" && p.length === 3) {
    const j = getJob(p[2]);
    return j ? send(res, 200, publicJob(j)) : send(res, 404, { error: "không có job" });
  }
  if (url.pathname === "/api/music") return send(res, 200, { music: listMusic() });
  if (url.pathname === "/api/media" && req.method === "POST") {
    const b = (await readBody(req, UPLOAD_LIMIT)) || {};
    return send(res, 201, b.data_base64 ? await uploadBase64(b.filename, b.data_base64) : await uploadFromUrl(String(b.url || "")));
  }
  if (url.pathname === "/api/tts" && req.method === "POST") {
    const b = (await readBody(req)) || {};
    return send(res, 200, await speak(b.text, b.voice));
  }
  send(res, 404, { error: "không có đường này" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.code === 413 ? 413 : e instanceof SyntaxError ? 400 : 400, { error: String(e.message || e) });
  });
});
server.requestTimeout = 0; // MCP create_video có thể chờ tới ~5 phút
server.listen(PORT, HOST, () => console.log(`LL Video Hub nghe ${HOST}:${PORT}`));
ensureBundle().catch((e) => console.error("bundle lỗi", e));
