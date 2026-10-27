---
name: nha-may-video-mac
description: Dựng video MP4 có giọng đọc tiếng Việt (VieNeu-TTS), phụ đề karaoke, chuyển cảnh bằng nhà máy video trên Mac của Long (GPU, Remotion), hoặc đọc một đoạn văn thành file WAV. Dùng khi cần "làm video", "dựng video ngắn/Reels/Shorts/TikTok", "video giải thích", "đọc thành giọng nói tiếng Việt", "TTS tiếng Việt" mà máy mình không có GPU. Gọi qua MCP server con `video-hub` của ll-hub.
---

# Nhà máy video trên Mac (video-hub)

Mac của Long (i9 + AMD Radeon Pro 5500M) dựng video bằng **Remotion** trên GPU và đọc giọng bằng **VieNeu-TTS** (25 giọng Việt Bắc/Trung/Nam + 5 giọng thật của Long). Dựng trên GPU nhanh hơn CPU trên 10 lần: video 30 giây ≈ 1–1,5 phút. Một job chạy một lúc, job sau xếp hàng.

## Gọi qua ll-hub (cách chuẩn)
```
call_upstream_tool(server="video-hub", tool="list_voices", arguments={})
call_upstream_tool(server="video-hub", tool="create_video", arguments={
  "title": "3 mẹo ChatGPT viết email",
  "aspect": "9:16",            # 9:16 (Reels/TikTok/Shorts) | 16:9 (YouTube) | 1:1
  "theme": "midnight",         # midnight | sunrise | ocean | forest | paper
  "voice": "Ngọc Huyền",       # id từ list_voices
  "brand": "luuhailong.com",
  "scenes": [
    {"heading": "3 mẹo dùng *ChatGPT* viết email", "emoji": "⚡", "text": "Ba mẹo dùng ChatGPT để viết email nhanh gấp đôi."},
    {"heading": "Mẹo 1: Cho bối cảnh", "emoji": "🎯", "bullets": ["Bạn là ai", "Gửi cho ai", "Muốn họ làm gì"],
     "text": "Mẹo một. Hãy nói rõ bạn là ai, gửi cho ai, và muốn người đọc làm gì."}
  ],
  "wait_seconds": 240
})
# chưa xong thì: call_upstream_tool(server="video-hub", tool="get_video_status", arguments={"id": "...", "wait_seconds": 240})
```
Khi `status = "done"`: `download_url` (MP4) và `poster_url` (ảnh bìa). Link có khoá riêng, tải được từ mọi máy trong tailnet không cần token (`curl -o video.mp4 <download_url>`). Không gửi link ra ngoài tailnet: máy ngoài không mở được.

`create_video` và `text_to_speech` không cần xin duyệt (chỉ tạo file nội bộ). **Đăng video lên mạng xã hội/kênh ngoài vẫn phải `request_approval`.**

## Hai mẫu video
| `template` | Dùng khi | Khung | Mỗi cảnh cần |
|---|---|---|---|
| `explainer` (mặc định) | giải thích, mẹo, danh sách | 9:16 / 16:9 / 1:1, 5 `theme` | `text` + `heading`/`bullets`/`emoji`/`image_url` |
| `kinetic` | video ngắn kể theo nhịp, chữ động mạnh | chỉ 9:16, `style`: `vox` (giấy, halftone) / `kinetic` (nền tối, xanh chanh) | `text` + `kind` + trường theo kind |

**Mẫu kinetic** — xếp cảnh theo nhịp `hook → item… → warn → risk → takeaway → cta` (không bắt buộc đủ cả):
- `hook`: `kicker` (dòng nhỏ), `lines` (2–3 dòng chữ lớn, dòng 2 to nhất, bọc `*từ*` để nhấn)
- `item`: `num`, `title`, `prompt` (câu lệnh mẫu hiện trong khung), `visual` một trong:
  `{"type":"table","head":[...],"rows":[[...]]}` · `{"type":"rewrite","before":"...","after":"...","hot":["từ","nhấn"]}` ·
  `{"type":"sort","groups":["A","B","C"],"notes":[{"t":"ghi chú","g":0}]}`
- `warn`: `title`, `sub` · `risk`: `title`, `visual: {"before","wrong","after","sign"}` (câu có một chữ sai bị khoanh)
- `takeaway`: `title` · `cta`: `title`, `sub`
Mẫu đầy đủ: `examples/ai-van-phong.json` trong repo github.com/hailongluu/video-hub (đổi khoá `voice` thành `text`).

## Nhạc nền, ảnh, file của mình
- `list_music` → tên nhạc có sẵn; truyền `music: "<tên>"`. Kinetic mặc định có nhạc theo style; explainer mặc định không nhạc; `music: "none"` để tắt.
  Nhạc tự nhỏ lại khi có giọng (sidechain), nhỏ dần cuối video, cả bản chuẩn -14 LUFS.
- **Tải file của mình lên:** `upload_media(filename, data_base64)` (nội dung file mã hoá base64) hoặc `upload_media(url="https://...")`
  → trả `media_id` dạng `media:<id>`. Ảnh jpg/png/webp/gif, nhạc m4a/mp3/wav/ogg (≤ 10 phút), tối đa 10 MB/file.
  Dùng: `image_url: "media:<id>"` (cảnh explainer) hoặc `music: "media:<id>"`. File giữ trên nhà máy, dùng lại được cho nhiều video.
- `image_url`/`music` cũng nhận thẳng `https://...` (nhà máy tự tải về).
- Chỉ dùng nhạc/ảnh có quyền sử dụng (tự làm, mua bản quyền, CC0). Không lấy nhạc/ảnh trên mạng về dùng tuỳ tiện.

## Viết cảnh cho hay
- Mỗi cảnh = 1–2 câu lời đọc (`text`, ≤ 800 ký tự) + chữ trên màn hình (`heading`, `bullets` ≤ 6 dòng ngắn, `emoji`). 5–8 cảnh ≈ 30–60 giây.
- Cảnh đầu là hook: tiêu đề ngắn, bọc *từ khoá* hoặc *cả cụm từ* để tô màu nhấn. Cảnh cuối là lời kêu gọi.
- `heading` ≤ 6–7 chữ (khung dọc 9:16 chỉ vừa ~2 dòng chữ lớn); ý dài để ở `bullets` hoặc lời đọc.
- Không bịa số liệu, phần trăm, "nghiên cứu cho thấy" khi không có nguồn thật.
- `bullets` hiện lần lượt theo lời đọc: viết khớp thứ tự với câu nói.
- Lời đọc: viết đúng chính tả, có dấu câu (dấu chấm/phẩy tạo nhịp nghỉ). Số và từ viết tắt nên viết thành chữ nếu cần đọc chuẩn ("ba mẹo", "trí tuệ nhân tạo").
- `image_url` (http/https, jpg/png/webp ≤ 15 MB): ảnh nền phủ tối + Ken Burns; nhà máy tự tải ảnh về.
- Phụ đề karaoke bật mặc định (`captions: false` để tắt).

## Giọng thật của Long ("Long Lưu")
Clone từ bản ghi thật của Long (27/10/2026), độ giống ~0,8 theo vân giọng. 5 phong cách, chọn theo nội dung:
`Long Lưu` (thuyết trình, mặc định cho giọng Long) · `Long Lưu · truyền cảm hứng` · `Long Lưu · tâm sự` · `Long Lưu · vlog` · `Long Lưu · dẫn chương trình`.
- Chỉ dùng cho nội dung **của Long / công ty Long**, nói đúng quan điểm của Long. Không dùng giọng này để nói thay người khác, quảng cáo cho bên thứ ba, hay nội dung Long chưa duyệt.
- Video dùng giọng Long khi đăng ra ngoài: `request_approval` như mọi việc đăng bài, ghi rõ "dùng giọng Long".

## Chỉ cần giọng đọc
`call_upstream_tool(server="video-hub", tool="text_to_speech", arguments={"text": "...", "voice": "Thiện Minh"})` → WAV 48 kHz (≤ 3000 ký tự/lần).

## Lỗi thường gặp
- Hub báo không kết nối được `video-hub`: nhà máy đang **tắt** (Long chỉ bật bằng app "Video Hub" trên thanh menu Mac khi cần, để máy không nóng) hoặc Mac đang ngủ. Báo Long "cần bật Video Hub", không thử lại liên tục.
- `không có giọng '...'`: gọi `list_voices` lấy đúng id (có dấu, ví dụ "Ngọc Huyền").
- Job `failed` có `error`: thường do ảnh không tải được; sửa `image_url` rồi gọi lại.
- Lời gọi `create_video` hiếm khi trả lỗi không rõ dù tham số đúng: gọi lại một lần là được. Vẫn lỗi thì gọi `list_videos` xem job có được tạo không trước khi tạo thêm (tránh dựng trùng).

## Thời gian chờ
Tổng thời gian ≈ 2,4 lần độ dài video (đọc giọng ~0,6× + dựng hình ~1,6×), cộng thời gian chờ các job khác trong hàng. Video 35 giây ≈ 85 giây.
Video dài hơn ~100 giây thì `wait_seconds` (tối đa 280) không đủ: gọi `get_video_status` thêm lần nữa, đừng tạo job mới.

## Tự kiểm tra video trước khi giao
Tải về rồi trích vài khung (`ffmpeg -ss <giây> -i video.mp4 -frames:v 1 f.png`) để xem chữ có tràn, có dấu tiếng Việt đủ không.
Giữa hai cảnh có hiệu ứng chuyển ~0,4 giây (trượt/mờ dần): khung chụp đúng lúc đó sẽ thấy hai cảnh chồng nhau, **không phải lỗi**. Chọn thời điểm giữa cảnh để kiểm.

## Nhật ký lỗi đã gặp (đã sửa trong nhà máy, ghi lại để biết)
- 27/10/2026: cụm nhấn nhiều chữ `*ngộp email*` không được tô màu (chỉ nhận `*một-chữ*`) → đã sửa, nay nhấn được cả cụm.
- 27/10/2026: tiêu đề xuống dòng lẻ một chữ ("Ra lệnh rõ / ràng") → đã sửa, chữ chia dòng cân bằng.
- 27/10/2026: mẫu kinetic + nhạc nền trước chỉ chạy bằng script trên Mac, agent qua hub không gọi được, không gửi được ảnh/nhạc của mình → nay có `template`, `style`, `music`, `list_music`, `upload_media`.
- 27/10/2026: trộn nhạc treo vô hạn (job kẹt ở "trộn âm thanh") do ffmpeg 4.3 của Anaconda → nhà máy dùng ffmpeg Homebrew 8.x. Job lỗi giờ báo đúng lý do của ffmpeg.
- 27/10/2026: video có nhạc to hơn chuẩn (-10,9 LUFS) → đã thêm bước đo và chỉnh về -14 LUFS.
Gặp lỗi mới: ghi thêm vào đây (ngày, triệu chứng, cách tránh) và báo Long.
