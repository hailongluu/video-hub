import path from "node:path";
import crypto from "node:crypto";
import { DATA, PUBLIC_URL, ttsVoices } from "./config.mjs";
import { queuePos, tts } from "./jobs.mjs";

export function publicJob(j) {
  const o = { id: j.id, status: j.status, stage: j.stage, progress: +(j.progress || 0).toFixed(2), title: j.spec?.title, created: j.created };
  if (j.status === "queued") o.queue_position = queuePos(j.id) + 1;
  if (j.status === "failed") o.error = j.error;
  if (j.status === "done") {
    o.download_url = `${PUBLIC_URL}/files/${j.id}/${j.key}/video.mp4`;
    o.poster_url = `${PUBLIC_URL}/files/${j.id}/${j.key}/poster.jpg`;
    o.result = j.result;
  }
  return o;
}

export async function speak(text, voice) {
  if (typeof text !== "string" || !text.trim()) throw new Error("text trống");
  if (text.length > 3000) throw new Error("text quá 3000 ký tự");
  voice = voice || "Ngọc Huyền";
  if (!(await ttsVoices()).some((v) => v.id === voice)) throw new Error(`không có giọng '${voice}'`);
  const id = crypto.randomBytes(12).toString("hex");
  const duration = await tts(text, voice, path.join(DATA, "tts", `${id}.wav`));
  return { duration, voice, download_url: `${PUBLIC_URL}/tts/${id}.wav` };
}
