---
name: nha-may-video-mac
description: Dựng video MP4 có giọng đọc tiếng Việt (VieNeu-TTS), phụ đề karaoke, chuyển cảnh bằng nhà máy video trên Mac của Long (GPU, Remotion), hoặc đọc một đoạn văn thành file WAV. Dùng khi cần "làm video", "dựng video ngắn/Reels/Shorts/TikTok", "video giải thích", "đọc thành giọng nói tiếng Việt", "TTS tiếng Việt" mà máy mình không có GPU. Gọi qua MCP server con `video-hub` của ll-hub.
---

# Nhà máy video trên Mac (video-hub)

Mac của Long (i9 + AMD Radeon Pro 5500M) dựng video bằng **Remotion** trên GPU và đọc giọng bằng **VieNeu-TTS** (25 giọng Việt Bắc/Trung/Nam). Dựng trên GPU nhanh hơn CPU trên 10 lần: video 30 giây ≈ 1–1,5 phút. Một job chạy một lúc, job sau xếp hàng.

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

## Viết cảnh cho hay
- Mỗi cảnh = 1–2 câu lời đọc (`text`, ≤ 800 ký tự) + chữ trên màn hình (`heading`, `bullets` ≤ 6 dòng ngắn, `emoji`). 5–8 cảnh ≈ 30–60 giây.
- Cảnh đầu là hook: tiêu đề ngắn, bọc *từ khoá* hoặc *cả cụm từ* để tô màu nhấn. Cảnh cuối là lời kêu gọi.
- `heading` ≤ 6–7 chữ (khung dọc 9:16 chỉ vừa ~2 dòng chữ lớn); ý dài để ở `bullets` hoặc lời đọc.
- Không bịa số liệu, phần trăm, "nghiên cứu cho thấy" khi không có nguồn thật.
- `bullets` hiện lần lượt theo lời đọc: viết khớp thứ tự với câu nói.
- Lời đọc: viết đúng chính tả, có dấu câu (dấu chấm/phẩy tạo nhịp nghỉ). Số và từ viết tắt nên viết thành chữ nếu cần đọc chuẩn ("ba mẹo", "trí tuệ nhân tạo").
- `image_url` (http/https, jpg/png/webp ≤ 15 MB): ảnh nền phủ tối + Ken Burns; nhà máy tự tải ảnh về.
- Phụ đề karaoke bật mặc định (`captions: false` để tắt).

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
Gặp lỗi mới: ghi thêm vào đây (ngày, triệu chứng, cách tránh) và báo Long.
