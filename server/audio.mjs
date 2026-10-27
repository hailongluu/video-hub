// Trộn âm thanh cuối cho video: giọng từng cảnh đặt đúng thời điểm (hoặc giọng có sẵn trong video), nhạc nền tự nhỏ khi có giọng
// (sidechain), tiếng "tách" ở mỗi lần cắt cảnh, cả bản chuẩn hoá -14 LUFS. Tách từ scripts/render-kinetic.mjs để API dùng chung.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
// lỗi ffmpeg: giữ phần stderr (lý do thật) thay vì cả câu lệnh dài
const run = (cmd, args) => exec(cmd, args).catch((e) => {
  throw new Error(`${cmd} lỗi: ${String(e.stderr || e.message).trim().split("\n").slice(-4).join(" | ")}`);
});
// mọi nhánh âm thanh về cùng định dạng, nếu không sidechaincompress/amix không ghép được giọng mono với nhạc stereo
const FMT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

// Tiếng nhấn ngắn (giấy xé/whoosh) tự tổng hợp, không cần file
export async function makeHit(file) {
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.22:c=pink:a=0.6", "-f", "lavfi", "-i", "sine=f=90:d=0.22",
    "-filter_complex", "[0]highpass=f=900,lowpass=f=5000,afade=t=out:st=0.02:d=0.2[n];[1]afade=t=out:st=0:d=0.2,volume=1.6[s];[n][s]amix=inputs=2,volume=2", file]);
  return file;
}

/**
 * video: mp4 đầu vào; videoVoice=true nếu giọng đã nằm sẵn trong video (Explainer), false nếu video câm (Kinetic)
 * voices: [{file, start}] khi videoVoice=false; music: đường dẫn nhạc hoặc null; hits: các mốc giây có tiếng nhấn
 * total: độ dài (giây); musicVolume: âm lượng nhạc trước khi ducking; out: mp4 ra
 */
export async function mixAudio({ video, videoVoice, voices = [], music, hits = [], total, out, musicVolume = 0.32, hitFile }) {
  const args = ["-y", "-v", "error", "-i", video];
  const f = [];
  let idx = 1;
  if (videoVoice) {
    f.push(`[0:a]aresample=48000,${FMT},apad,atrim=0:${total.toFixed(3)}[voice]`);
  } else {
    voices.forEach((v, i) => {
      args.push("-i", v.file);
      f.push(`[${idx}]aresample=48000,${FMT},adelay=${Math.round(v.start * 1000)}:all=1[v${i}]`);
      idx++;
    });
    f.push(`${voices.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voices.length}:dropout_transition=0,volume=${voices.length},apad,atrim=0:${total.toFixed(3)}[voice]`);
  }
  const parts = ["[vo]"];
  if (music) {
    args.push("-stream_loop", "-1", "-i", music);
    const mi = idx++;
    // bỏ 6 giây đầu bài (thường là đoạn dạo), nhỏ dần ở cuối, tự nhỏ khi có giọng
    const skip = 6;
    f.push(`[voice]asplit=2[vo][key]`);
    f.push(`[${mi}]atrim=${skip}:${(skip + total).toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,${FMT},volume=${musicVolume},afade=t=out:st=${Math.max(total - 1.2, 0).toFixed(2)}:d=1.2[mus]`);
    f.push(`[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300[duck]`);
    parts.push("[duck]");
  } else {
    f.push(`[voice]anull[vo]`);
  }
  if (hits.length) {
    const hf = hitFile || (await makeHit(path.join(path.dirname(out), "hit.wav")));
    args.push("-i", hf);
    const hi = idx++;
    f.push(`[${hi}]aresample=48000,${FMT},asplit=${hits.length}${hits.map((_, i) => `[hs${i}]`).join("")}`);
    hits.forEach((t, i) => {
      f.push(`[hs${i}]adelay=${Math.max(Math.round((t - 0.03) * 1000), 0)}:all=1,volume=0.5[h${i}]`);
      parts.push(`[h${i}]`);
    });
  }
  const n = parts.length;
  f.push(`${parts.join("")}amix=inputs=${n}:dropout_transition=0,volume=${n},loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  args.push("-filter_complex", f.join(";"), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", total.toFixed(3), "-movflags", "+faststart", out);
  await run("ffmpeg", args);
  await fixLoudness(out);
  return out;
}

// loudnorm một lượt sau amix lệch tới ~3 LU: đo lại (EBU R128) và chỉnh về -14 LUFS, chặn đỉnh -1.5 dBTP
export async function fixLoudness(file, target = -14) {
  const { stderr } = await exec("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-map", "0:a", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr);
  if (!m) return;
  const gain = target - parseFloat(m[1]);
  if (Math.abs(gain) < 0.7) return;
  const tmp = file.replace(/\.mp4$/, ".lufs.mp4");
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:v", "-map", "0:a", "-c:v", "copy",
    "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", tmp]);
  await fs.rename(tmp, file);
}
