// MCP server (Streamable HTTP, không phiên) cho agent ở máy khác: dựng video, đọc giọng.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createJob, getJob, listJobs, validate, THEMES } from "./jobs.mjs";
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
  heading: z.string().optional().describe("Tiêu đề lớn trên màn hình; bọc *từ* để tô màu nhấn"),
  bullets: z.array(z.string()).optional().describe("Tối đa 6 ý ngắn, hiện lần lượt theo lời đọc"),
  emoji: z.string().optional().describe("Biểu tượng lớn, ví dụ ⚡ 💡 📈"),
  image_url: z.string().optional().describe("Ảnh nền http(s) (jpg/png/webp ≤ 15 MB), có hiệu ứng Ken Burns"),
});

function build() {
  const s = new McpServer({ name: "ll-video-hub", version: "1.0.0" }, {
    instructions:
      "Nhà máy video trên Mac của Long (GPU AMD, Remotion + giọng Việt VieNeu-TTS). Quy trình: list_voices → create_video(scenes) " +
      "→ get_video_status(id, wait_seconds) tới khi status=done → dùng download_url (tải trong tailnet). Mỗi cảnh = một câu/đoạn lời đọc + " +
      "tiêu đề/ý chính trên màn hình. Video 60 giây thường xong trong 1-3 phút. Một job chạy một lúc, job sau xếp hàng.",
  });

  s.registerTool("list_voices", { description: "Danh sách giọng đọc tiếng Việt (id dùng cho create_video/text_to_speech).", inputSchema: {} },
    async () => { try { return json({ voices: await ttsVoices() }); } catch (e) { return fail(e); } });

  s.registerTool("create_video", {
    description: "Xếp hàng dựng một video MP4 có giọng đọc, phụ đề karaoke, chuyển cảnh. Trả về id job; gọi get_video_status để chờ. " +
      "Đặt wait_seconds (≤ 280) để chờ luôn trong lần gọi này.",
    inputSchema: {
      title: z.string().optional(),
      scenes: z.array(sceneSchema).min(1).max(30),
      voice: z.string().optional().describe("id giọng, mặc định 'Ngọc Huyền' (nữ Bắc)"),
      aspect: z.enum(["9:16", "16:9", "1:1"]).optional().describe("Mặc định 9:16 (Reels/TikTok/Shorts)"),
      theme: z.enum(THEMES).optional().describe("Bảng màu, mặc định midnight"),
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
