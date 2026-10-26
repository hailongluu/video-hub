# LL Video Hub — nhà máy video trên Mac

Dịch vụ dựng video cho agent ở các máy khác trong tailnet: giọng đọc tiếng Việt **VieNeu-TTS** + dựng hình **Remotion** trên GPU của Mac
(i9-9880H, AMD Radeon Pro 5500M 4 GB). Có REST API và MCP server, đăng trên ll-hub thành server con `video-hub`.

| | |
|---|---|
| MCP | `http://100.72.113.110:8810/mcp` (Streamable HTTP, không phiên, header `Authorization: Bearer <token>`) |
| Qua ll-hub | `call_upstream_tool(server="video-hub", ...)`; skill `nha-may-video-mac` |
| Token | `data/token` (0600, tạo lần đầu chạy); hub giữ bản sao ở secret nhóm `video-hub` |
| Truy cập | chỉ `127.0.0.1` và tailnet `100.64.0.0/10`; link tải có khoá riêng trong đường dẫn |

## Kiến trúc
```
tts/server.py        FastAPI 127.0.0.1:8811, giữ model VieNeu (mặc định v3 Turbo ONNX, CPU) trong RAM; WAV 48 kHz
server/index.mjs     HTTP :8810 — /mcp, /api/*, /files/<id>/<khoá>/video.mp4, /internal/<khoá chạy>/... (chỉ Chrome cục bộ)
server/jobs.mjs      hàng đợi 1 job/lần, data/jobs/<id>/job.json; TTS từng cảnh → phụ đề → render
server/render.mjs    bundle Remotion 1 lần; renderMedia gl=angle (GPU) + hardwareAcceleration if-possible; ffmpeg loudnorm -14 LUFS
server/captions.mjs  chia lời đọc thành cụm 2–6 từ, thời gian theo số từ + dấu câu
server/mcp.mjs       tool: list_voices, create_video, get_video_status, list_videos, text_to_speech
remotion/            composition Explainer (9:16/16:9/1:1, 5 bảng màu, emoji, bullet, ảnh Ken Burns, phụ đề karaoke)
skill/               skill hướng dẫn agent (đăng lên ll-hub)
app/VideoHub.swift   app thanh menu bật/tắt (scripts/build-app.sh)
```

## Hiệu năng (đo 26–27/10/2026)
- TTS: ~0,6–0,7 giây xử lý cho 1 giây giọng (CPU; bản PyTorch/GPU không chạy trên Mac Intel vì không có wheel).
- Render 27 giây video 1080×1920: **49 giây với GPU** (ANGLE/Metal); SwiftShader (CPU) > 9 phút chưa xong. Tổng 1 job 27 giây ≈ 80 giây.

## Bật / tắt (app "Video Hub" trên thanh menu)
Nhà máy **không tự chạy** (chạy liên tục làm máy nóng). Mở `~/Applications/Video Hub.app` → biểu tượng 🎞 trên thanh menu:
- **Bật nhà máy (TTS + engine)**: khởi động dịch vụ giọng VieNeu (127.0.0.1:8811, nạp model ~10 giây) và engine Remotion + API/MCP (:8810).
  Menu hiện ●/○ cho từng phần và số job đang dựng/chờ/xong; biểu tượng đậm khi bật, có chữ "dựng" khi đang render.
- **Tắt nhà máy** / **Thoát**: dừng cả hai (kể cả tiến trình chạy tay từ terminal và Chrome của Remotion còn sót).
- Khi đang bật, Mac không ngủ lúc rảnh (`caffeinate -i`). Gập máy không cắm màn hình ngoài thì vẫn ngủ.
- `open -a "Video Hub" --args --start`: mở app và bật luôn.

```bash
cd tts && uv sync && cd .. && npm ci
scripts/build-app.sh               # dựng lại ~/Applications/Video Hub.app (sau khi sửa app/VideoHub.swift hoặc đổi bản node/uv)
```
Log: `~/Library/Logs/video-hub.log`, `~/Library/Logs/video-hub-tts.log`. Chạy tay không cần app: `(cd tts && uv run python server.py)` và `npm start`.
`npm run studio` mở Remotion Studio để chỉnh composition.

**Tường lửa macOS** đang bật. Node chạy từ app đã nhận kết nối từ tailnet (đã thử từ vps4ty2 ngày 27/10). Nếu máy khác gọi vào bị treo:
System Settings → Network → Firewall → Options → cho phép `~/.nvm/versions/node/v22.14.0/bin/node`.

## REST API
```bash
T=$(cat data/token)
curl -s -XPOST localhost:8810/api/videos -H "Authorization: Bearer $T" -H 'content-type: application/json' -d @examples/3-meo-chatgpt.json
curl -s localhost:8810/api/videos/<id> -H "Authorization: Bearer $T"     # status, progress, download_url
curl -s -XPOST localhost:8810/api/tts -H "Authorization: Bearer $T" -d '{"text":"Xin chào","voice":"Thiện Minh"}'
```
Body `create`: `title`, `aspect` (9:16|16:9|1:1), `theme` (midnight|sunrise|ocean|forest|paper), `voice`, `brand`, `captions`,
`scenes[]` = `{text, heading?, bullets?, emoji?, image_url?}` (≤ 30 cảnh, ≤ 800 ký tự/cảnh, ≤ 8000 tổng).

## Ghi chú cài đặt
- `vieneu` trên Mac Intel: phải ghim `onnxruntime==1.23.2`, `numba<0.62`, `llvmlite<0.45` (bản mới không có wheel x86_64 macOS).
- Giọng có watermark không nghe được của VieNeu (mặc định của thư viện).
- Chưa có nhạc nền (nhạc FreePD nằm ở nhà máy video trên home-3).
