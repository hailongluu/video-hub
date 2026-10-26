// Dựng video bằng Remotion: bundle một lần, mỗi job selectComposition + renderMedia.
// GPU: Chrome dùng ANGLE (Metal → AMD Radeon), mã hoá H.264 bằng VideoToolbox nếu có.
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const GL = process.env.VH_GL || "angle";
const CONCURRENCY = Number(process.env.VH_CONCURRENCY || Math.max(2, Math.floor(os.cpus().length / 2)));

let serveUrl;
export async function ensureBundle() {
  if (!serveUrl) {
    const t = Date.now();
    serveUrl = await bundle({ entryPoint: path.join(ROOT, "remotion/index.ts") });
    console.log(`bundle Remotion xong sau ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  return serveUrl;
}

const chromiumOptions = { gl: GL };

export async function renderVideo(props, outDir, onProgress) {
  const url = await ensureBundle();
  const composition = await selectComposition({ serveUrl: url, id: "Explainer", inputProps: props, chromiumOptions });
  const raw = path.join(outDir, "raw.mp4");
  const t = Date.now();
  await renderMedia({
    serveUrl: url,
    composition,
    inputProps: props,
    codec: "h264",
    outputLocation: raw,
    chromiumOptions,
    concurrency: CONCURRENCY,
    hardwareAcceleration: "if-possible",
    videoBitrate: composition.width * composition.height > 2e6 ? "8M" : "6M",
    audioBitrate: "192k",
    onProgress: ({ progress }) => onProgress?.(progress),
  });
  const renderSec = (Date.now() - t) / 1000;
  const out = path.join(outDir, "video.mp4");
  // Chuẩn hoá âm lượng -14 LUFS (mức YouTube/Facebook), giữ nguyên hình
  await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  await renderStill({ serveUrl: url, composition, inputProps: props, output: path.join(outDir, "poster.jpg"), frame: Math.min(45, composition.durationInFrames - 1), imageFormat: "jpeg", chromiumOptions });
  return { width: composition.width, height: composition.height, frames: composition.durationInFrames, seconds: composition.durationInFrames / composition.fps, renderSec };
}
