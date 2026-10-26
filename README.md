# LL Video Hub — nhà máy video trên Mac

Dịch vụ dựng video cho agent ở các máy khác trong tailnet: giọng đọc tiếng Việt **VieNeu-TTS** + dựng hình **Remotion** trên GPU của Mac
(i9-9880H, AMD Radeon Pro 5500M 4 GB). Có REST API và MCP server, đăng trên ll-hub thành server con `video-hub`.

| | |
|---|---|
| MCP | `http://100.72.113.110:8810/mcp` (Streamable HTTP, không phiên, header `Authorization: Bearer <token>`) |
| Qua ll-hub | `call_upstream_tool(server="video-hub", ...)`; skill `nha-may-video-mac` |
| Token | `~/Library/Application Support/VideoHub/token` (0600, tạo lần đầu chạy); hub giữ bản sao ở secret nhóm `video-hub` |
| Nơi lưu video | mặc định `~/Movies/VideoHub` (ngoài iCloud), đổi trong app: **Đổi nơi lưu video…**; ghi ở `~/Library/Application Support/VideoHub/config.json` (`dataDir`), biến `VH_DATA` ghi đè |
| Truy cập | chỉ `127.0.0.1` và tailnet `100.64.0.0/10`; link tải có khoá riêng trong đường dẫn |

## Kiến trúc
```
tts/server.py        FastAPI 127.0.0.1:8811, giữ model VieNeu (mặc định v3 Turbo ONNX, CPU) trong RAM; WAV 48 kHz
server/index.mjs     HTTP :8810 — /mcp, /api/*, /files/<id>/<khoá>/video.mp4, /internal/<khoá chạy>/... (chỉ Chrome cục bộ)
server/jobs.mjs      hàng đợi 1 job/lần, <nơi lưu>/jobs/<id>/job.json; TTS từng cảnh → phụ đề → render
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
- **Đổi nơi lưu video…**: chọn thư mục (cảnh báo nếu nằm trong Desktop/Documents vì iCloud đồng bộ), hỏi có chuyển video cũ không.
  Chuyển thì link tải cũ của agent vẫn dùng được (link = id + khoá của job, không phụ thuộc đường dẫn). Đang bật thì app tự tắt, chuyển, bật lại.
  Chọn ổ ngoài (`/Volumes/...`) mà ổ chưa cắm thì app báo và không bật.

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
T=$(cat ~/Library/Application\ Support/VideoHub/token)
curl -s -XPOST localhost:8810/api/videos -H "Authorization: Bearer $T" -H 'content-type: application/json' -d @examples/3-meo-chatgpt.json
curl -s localhost:8810/api/videos/<id> -H "Authorization: Bearer $T"     # status, progress, download_url
curl -s -XPOST localhost:8810/api/tts -H "Authorization: Bearer $T" -d '{"text":"Xin chào","voice":"Thiện Minh"}'
```
Body `create`: `title`, `aspect` (9:16|16:9|1:1), `theme` (midnight|sunrise|ocean|forest|paper), `voice`, `brand`, `captions`,
`scenes[]` = `{text, heading?, bullets?, emoji?, image_url?}` (≤ 30 cảnh, ≤ 800 ký tự/cảnh, ≤ 8000 tổng).

## Giọng riêng (giọng thật của Long)
`~/Library/Application Support/VideoHub/custom_voices.json` (0600, KHÔNG nằm trong repo): vân giọng + mã tham chiếu, TTS nạp khi khởi động.
Tạo bằng các script trong `voice-lab/` (chạy bằng python của `tts/.venv`; Whisper chạy bằng venv riêng có `faster-whisper`), thư mục làm việc `~/Movies/VideoHub/voice-lab`:
1. `sample_speakers.py` cắt mẫu 8 s trong các bản ghi, tính vân giọng VieNeu (192 chiều) → `cluster.py` gom cụm người nói, ghép đoạn nghe thử.
2. Người thật nghe xác nhận cụm nào là giọng mình (không tự đoán).
3. `pick_refs.py` / `segments.py` chọn đoạn nói liền 3–8 s sạch nhất mỗi phong cách → `make_long_voices.py` gọi `add_voice` (không cần lời chép), lưu file giọng và đọc thử.
Không cần fine-tune: v3 Turbo clone tức thì trên CPU; bản fine-tune LoRA chỉ chạy bằng PyTorch/GPU, chậm trên Mac Intel.

## Ghi chú cài đặt
- `vieneu` trên Mac Intel: phải ghim `onnxruntime==1.23.2`, `numba<0.62`, `llvmlite<0.45` (bản mới không có wheel x86_64 macOS).
- Giọng có watermark không nghe được của VieNeu (mặc định của thư viện).
- Chưa có nhạc nền (nhạc FreePD nằm ở nhà máy video trên home-3).
