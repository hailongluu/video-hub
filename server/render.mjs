// Dựng video bằng Remotion: bundle một lần, mỗi job selectComposition + renderMedia.
// GPU: Chrome dùng ANGLE (Metal → AMD Radeon), mã hoá H.264 bằng VideoToolbox nếu có.
import path from "node:path";
import os from "node:os";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

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

// Dựng hình một composition ra raw.mp4 (Explainer có giọng nằm sẵn trong video; Kinetic dựng câm, giọng trộn sau ở audio.mjs)
export async function renderVideo(props, outDir, onProgress, { id = "Explainer", muted = false } = {}) {
  const url = await ensureBundle();
  const composition = await selectComposition({ serveUrl: url, id, inputProps: props, chromiumOptions });
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
    muted,
    videoBitrate: id === "Kinetic" ? "10M" : composition.width * composition.height > 2e6 ? "8M" : "6M",
    audioBitrate: "192k",
    onProgress: ({ progress }) => onProgress?.(progress),
  });
  const renderSec = (Date.now() - t) / 1000;
  await renderStill({ serveUrl: url, composition, inputProps: props, output: path.join(outDir, "poster.jpg"),
    frame: Math.min(id === "Kinetic" ? 40 : 45, composition.durationInFrames - 1), imageFormat: "jpeg", chromiumOptions });
  return { raw, width: composition.width, height: composition.height, frames: composition.durationInFrames,
    seconds: composition.durationInFrames / composition.fps, renderSec };
}
