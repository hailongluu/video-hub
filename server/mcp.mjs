// MCP server (Streamable HTTP, không phiên) cho agent ở máy khác: dựng video, đọc giọng.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createJob, getJob, listJobs, validate, KINDS, KINETIC_STYLES, TEMPLATES, THEMES } from "./jobs.mjs";
import { listMusic, uploadBase64, uploadFromUrl } from "./media.mjs";
import { ttsVoices } from "./config.mjs";
import { publicJob, speak } from "./api.mjs";

const json = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }], structuredContent: o });
const fail = (e) => ({ content: [{ type: "text", text: `Lỗi: ${e.message || e}` }], isError: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id, seconds) {
  const end = Date.now() + Math.min(seconds, 280) * 1000;
  let j = getJob(id);
  while (j && (j.status === "queued" || j.status === "running") && Date.now() < end) {
    await sleep(2000);
    j = getJob(id);
  }
  return j;
}

const sceneSchema = z.object({
  text: z.string().describe("Lời đọc tiếng Việt của cảnh (giọng VieNeu đọc nguyên văn). Viết số bằng chữ nếu muốn đọc chuẩn."),
  // mẫu explainer
  heading: z.string().optional().describe("[explainer] Tiêu đề lớn; bọc *cụm từ* để tô màu nhấn"),
  bullets: z.array(z.string()).optional().describe("[explainer] Tối đa 6 ý ngắn, hiện lần lượt theo lời đọc"),
  emoji: z.string().optional().describe("[explainer] Biểu tượng lớn, ví dụ ⚡ 💡 📈"),
  image_url: z.string().optional().describe("[explainer] Ảnh nền: media:<id> (upload_media) hoặc https://; Ken Burns + phủ tối"),
  // mẫu kinetic
  kind: z.enum(KINDS).optional().describe("[kinetic] hook | item | warn | risk | takeaway | cta (bắt buộc với mẫu kinetic)"),
  kicker: z.string().optional().describe("[kinetic hook] dòng nhỏ phía trên, ví dụ '3 việc nên giao · 1 việc đừng'"),
  lines: z.array(z.string()).optional().describe("[kinetic hook] 2–3 dòng chữ lớn hiện lần lượt; dòng 2 to nhất; bọc *từ* để nhấn"),
  num: z.number().optional().describe("[kinetic item] số thứ tự lớn (1, 2, 3...)"),
  title: z.string().optional().describe("[kinetic item/warn/risk/takeaway/cta] tiêu đề; bọc *từ* để nhấn"),
  sub: z.string().optional().describe("[kinetic warn/cta] dòng phụ"),
  prompt: z.string().optional().describe("[kinetic item] câu lệnh mẫu hiện trong khung, ví dụ câu prompt ChatGPT"),
  visual: z.record(z.any()).optional().describe("[kinetic] hình minh hoạ: item {type:'table',head,rows} | {type:'rewrite',before,after,hot} | " +
    "{type:'sort',groups,notes:[{t,g}]}; risk {before,wrong,after,sign}. Xem skill nha-may-video-mac"),
});

function build() {
  const s = new McpServer({ name: "ll-video-hub", version: "1.0.0" }, {
    instructions:
      "Nhà máy video trên Mac của Long (GPU AMD, Remotion + giọng Việt VieNeu-TTS). Quy trình: list_voices → create_video(scenes) " +
      "→ get_video_status(id, wait_seconds) tới khi status=done → dùng download_url (tải trong tailnet). Mỗi cảnh = một câu/đoạn lời đọc + " +
      "tiêu đề/ý chính trên màn hình. Hai mẫu: explainer (9:16/16:9/1:1, tiêu đề + gạch đầu dòng + ảnh nền) và kinetic (9:16, chữ động " +
      "kiểu vox/kinetic, kể theo nhịp hook → item → warn → risk → takeaway → cta). Nhạc nền: list_music hoặc upload_media. " +
      "Video 60 giây thường xong trong 1-3 phút. Một job chạy một lúc, job sau xếp hàng.",
  });

  s.registerTool("list_voices", { description: "Danh sách giọng đọc tiếng Việt (id dùng cho create_video/text_to_speech).", inputSchema: {} },
    async () => { try { return json({ voices: await ttsVoices() }); } catch (e) { return fail(e); } });

  s.registerTool("create_video", {
    description: "Xếp hàng dựng một video MP4 có giọng đọc, phụ đề karaoke, chuyển cảnh. Trả về id job; gọi get_video_status để chờ. " +
      "Đặt wait_seconds (≤ 280) để chờ luôn trong lần gọi này.",
    inputSchema: {
      title: z.string().optional(),
      template: z.enum(TEMPLATES).optional().describe("explainer (mặc định) | kinetic (chỉ 9:16, mỗi cảnh cần kind)"),
      style: z.enum(KINETIC_STYLES).optional().describe("[kinetic] vox (giấy, halftone, mặc định) | kinetic (nền tối, xanh chanh)"),
      music: z.string().optional().describe("Nhạc nền: tên trong list_music, media:<id>, https://, hoặc 'none'. Mặc định: kinetic có nhạc theo style, explainer không nhạc"),
      scenes: z.array(sceneSchema).min(1).max(30),
      voice: z.string().optional().describe("id giọng, mặc định 'Ngọc Huyền' (nữ Bắc)"),
      aspect: z.enum(["9:16", "16:9", "1:1"]).optional().describe("Mặc định 9:16 (Reels/TikTok/Shorts)"),
      theme: z.enum(THEMES).optional().describe("[explainer] Bảng màu, mặc định midnight"),
      brand: z.string().optional().describe("Chữ nhỏ trên đầu khung, ví dụ luuhailong.com"),
      captions: z.boolean().optional().describe("Phụ đề karaoke, mặc định bật"),
      wait_seconds: z.number().optional(),
    },
  }, async (a, extra) => {
    try {
      const j = await createJob(await validate(a), extra?.authInfo?.clientId || "mcp");
      return json(publicJob(a.wait_seconds ? await waitFor(j.id, a.wait_seconds) : j));
    } catch (e) { return fail(e); }
  });

  s.registerTool("get_video_status", {
    description: "Trạng thái job (queued/running/done/failed), tiến độ 0-1, download_url khi xong. wait_seconds (≤ 280) để chờ tới khi xong.",
    inputSchema: { id: z.string(), wait_seconds: z.number().optional() },
  }, async ({ id, wait_seconds }) => {
    const j = wait_seconds ? await waitFor(id, wait_seconds) : getJob(id);
    return j ? json(publicJob(j)) : fail(new Error(`không có job ${id}`));
  });

  s.registerTool("list_videos", { description: "Các job gần đây (mới nhất trước).", inputSchema: { limit: z.number().optional() } },
    async ({ limit }) => json({ videos: listJobs(Math.min(limit || 10, 50)).map(publicJob) }));

  s.registerTool("list_music", { description: "Nhạc nền có sẵn trong thư viện (dùng tên làm tham số music của create_video).", inputSchema: {} },
    async () => json({ music: listMusic() }));

  s.registerTool("upload_media", {
    description: "Tải ảnh (jpg/png/webp/gif) hoặc nhạc (m4a/mp3/wav/ogg, ≤ 10 phút) lên nhà máy, ≤ 10 MB. Trả media_id dạng media:<id> " +
      "để dùng làm image_url của cảnh hoặc music của create_video. Gửi data_base64 (nội dung file mã hoá base64) hoặc url http(s).",
    inputSchema: { filename: z.string().optional(), data_base64: z.string().optional(), url: z.string().optional() },
  }, async ({ filename, data_base64, url }) => {
    try {
      if (!data_base64 && !url) throw new Error("cần data_base64 hoặc url");
      return json(data_base64 ? await uploadBase64(filename, data_base64) : await uploadFromUrl(url));
    } catch (e) { return fail(e); }
  });

  s.registerTool("text_to_speech", {
    description: "Đọc một đoạn tiếng Việt (≤ 3000 ký tự) thành file WAV 48 kHz, trả download_url và thời lượng.",
    inputSchema: { text: z.string(), voice: z.string().optional() },
  }, async ({ text, voice }) => { try { return json(await speak(text, voice)); } catch (e) { return fail(e); } });

  return s;
}

export async function handleMcp(req, res, body) {
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
