import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/google-fonts/BeVietnamPro";
import { z } from "zod";

const { fontFamily } = loadFont("normal", { weights: ["500", "700", "800"], subsets: ["vietnamese", "latin"] });

export const FPS = 30;
export const TRANSITION = 12; // khung hình chồng nhau giữa hai cảnh
const TAIL = 0.45; // giây im lặng sau lời mỗi cảnh

export const THEMES = {
  midnight: { bg1: "#0b1020", bg2: "#1d2b53", accent: "#ffcc33", text: "#ffffff", sub: "#c9d3ee" },
  sunrise: { bg1: "#2b0f2e", bg2: "#b23a48", accent: "#ffd166", text: "#ffffff", sub: "#ffe3e0" },
  ocean: { bg1: "#03203c", bg2: "#0e6ba8", accent: "#5ef2d6", text: "#ffffff", sub: "#cfe8ff" },
  forest: { bg1: "#0f2417", bg2: "#2f6b3f", accent: "#e9ff70", text: "#ffffff", sub: "#d8f0dc" },
  paper: { bg1: "#fbf7ef", bg2: "#efe3cf", accent: "#e4572e", text: "#1f1a17", sub: "#5a4f45" },
} as const;

const caption = z.object({ text: z.string(), start: z.number(), end: z.number() });
const scene = z.object({
  heading: z.string().optional(),
  text: z.string(),
  bullets: z.array(z.string()).optional(),
  emoji: z.string().optional(),
  image: z.string().optional(),
  audio: z.string().optional(),
  duration: z.number(),
  captions: z.array(caption),
});
export const explainerSchema = z.object({
  title: z.string(),
  aspect: z.enum(["9:16", "16:9", "1:1"]),
  theme: z.enum(["midnight", "sunrise", "ocean", "forest", "paper"]),
  brand: z.string().optional(),
  music: z.string().optional(),
  showCaptions: z.boolean().optional(),
  scenes: z.array(scene).min(1),
});
export type ExplainerProps = z.infer<typeof explainerSchema>;
type Scene = z.infer<typeof scene>;

const SIZE = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] } as const;

export const sceneFrames = (s: Scene, last: boolean) => Math.ceil((s.duration + TAIL) * FPS) + (last ? 0 : TRANSITION);

export const explainerMetadata: CalculateMetadataFunction<ExplainerProps> = ({ props }) => {
  const total = props.scenes.reduce((n, s, i) => n + sceneFrames(s, i === props.scenes.length - 1), 0)
    - TRANSITION * (props.scenes.length - 1);
  const [width, height] = SIZE[props.aspect];
  return { durationInFrames: Math.max(total, FPS), width, height, fps: FPS };
};

type Theme = (typeof THEMES)[keyof typeof THEMES];

const Background: React.FC<{ t: Theme }> = ({ t }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const a = f / 90;
  const blob = (x: number, y: number, r: number, c: string, o: number) => (
    <div
      style={{
        position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%",
        background: c, opacity: o, filter: `blur(${r * 0.45}px)`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: `linear-gradient(${150 + Math.sin(a) * 20}deg, ${t.bg1}, ${t.bg2})` }}>
      {blob(width * (0.2 + 0.08 * Math.sin(a)), height * (0.25 + 0.05 * Math.cos(a * 0.8)), width * 0.35, t.accent, 0.18)}
      {blob(width * (0.85 + 0.06 * Math.cos(a * 0.7)), height * (0.75 + 0.06 * Math.sin(a)), width * 0.4, t.bg2, 0.5)}
    </AbsoluteFill>
  );
};

const Words: React.FC<{ text: string; size: number; color: string; delay: number; weight: number; accent?: string }> = ({
  text, size, color, delay, weight, accent,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // *từ* trong tiêu đề được tô màu nhấn
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontSize: size, fontWeight: weight, color, lineHeight: 1.18, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.28}px` }}>
      {words.map((w, i) => {
        const p = spring({ frame: f - delay - i * 3, fps, config: { damping: 14, mass: 0.6 } });
        const hot = /^\*.*\*[.,!?:]*$/.test(w);
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * size * 0.5}px) scale(${0.9 + 0.1 * p})`, color: hot && accent ? accent : undefined }}>
            {w.replace(/\*/g, "")}
          </span>
        );
      })}
    </div>
  );
};

const Captions: React.FC<{ s: Scene; t: Theme; base: number }> = ({ s, t, base }) => {
  const f = useCurrentFrame();
  const sec = f / FPS;
  const c = s.captions.find((x) => sec >= x.start && sec < x.end + 0.15);
  if (!c) return null;
  const words = c.text.split(/\s+/);
  const k = Math.floor(((sec - c.start) / Math.max(c.end - c.start, 0.01)) * words.length);
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "9%", display: "flex", justifyContent: "center" }}>
      <div style={{ background: "rgba(0,0,0,0.55)", borderRadius: base * 0.022, padding: `${base * 0.012}px ${base * 0.03}px`, fontSize: base * 0.048, fontWeight: 700, color: "#fff", textAlign: "center", lineHeight: 1.3 }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: i <= k ? t.accent : "#fff" }}>{w}{i < words.length - 1 ? " " : ""}</span>
        ))}
      </div>
    </div>
  );
};

const SceneView: React.FC<{ s: Scene; t: Theme; first: boolean; captions: boolean; frames: number }> = ({ s, t, first, captions, frames }) => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const base = Math.min(width, height);
  const portrait = height > width;
  const pop = spring({ frame: f, fps, config: { damping: 11 } });
  const bullets = s.bullets ?? [];
  const speak = s.duration * fps;
  return (
    <AbsoluteFill>
      {s.image ? (
        <AbsoluteFill>
          <Img src={s.image} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${interpolate(f, [0, frames], [1.05, 1.18])})` }} />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.75))` }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${portrait ? 14 : 8}% 8% ${portrait ? 24 : 18}%`, flexDirection: "column", gap: base * 0.04, textAlign: "center" }}>
        {s.emoji ? <div style={{ fontSize: base * (first ? 0.2 : 0.15), transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)` }}>{s.emoji}</div> : null}
        {s.heading ? (
          <Words text={s.heading} size={base * (first ? 0.1 : bullets.length ? 0.075 : 0.088)} color={s.image ? "#fff" : t.text} accent={t.accent} delay={4} weight={800} />
        ) : null}
        {first && s.heading ? (
          <div style={{ width: interpolate(pop, [0, 1], [0, base * 0.25]), height: base * 0.012, background: t.accent, borderRadius: 99 }} />
        ) : null}
        {bullets.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: base * 0.025, alignItems: "stretch", width: portrait ? "100%" : "70%" }}>
            {bullets.map((b, i) => {
              const at = 10 + (i * Math.max(speak - 30, 20)) / bullets.length;
              const p = spring({ frame: f - at, fps, config: { damping: 14 } });
              return (
                <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * -base * 0.15}px)`, display: "flex", alignItems: "center", gap: base * 0.025, background: "rgba(255,255,255,0.1)", borderLeft: `${base * 0.012}px solid ${t.accent}`, borderRadius: base * 0.02, padding: `${base * 0.022}px ${base * 0.03}px`, fontSize: base * 0.05, fontWeight: 700, color: s.image ? "#fff" : t.text, textAlign: "left" }}>
                  <span style={{ color: t.accent }}>{i + 1}</span>
                  <span>{b}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {!s.heading && !bullets.length && !captions ? (
          <Words text={s.text} size={base * 0.06} color={s.image ? "#fff" : t.text} accent={t.accent} delay={2} weight={700} />
        ) : null}
      </AbsoluteFill>
      {captions ? <Captions s={s} t={t} base={base} /> : null}
      {s.audio ? <Audio src={s.audio} /> : null}
    </AbsoluteFill>
  );
};

const Chrome: React.FC<{ t: Theme; brand?: string }> = ({ t, brand }) => {
  const f = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const base = Math.min(width, height);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: base * 0.008, width: `${(f / durationInFrames) * 100}%`, background: t.accent }} />
      {brand ? (
        <div style={{ position: "absolute", top: base * 0.04, width: "100%", textAlign: "center", fontSize: base * 0.03, fontWeight: 700, color: t.sub, letterSpacing: 2, opacity: 0.85 }}>{brand}</div>
      ) : null}
    </AbsoluteFill>
  );
};

export const Explainer: React.FC<ExplainerProps> = (p) => {
  const t = THEMES[p.theme];
  const captions = p.showCaptions ?? true;
  const n = p.scenes.length;
  return (
    <AbsoluteFill style={{ fontFamily, background: t.bg1 }}>
      <Background t={t} />
      <TransitionSeries>
        {p.scenes.flatMap((s, i) => {
          const frames = sceneFrames(s, i === n - 1);
          const seq = (
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={frames}>
              <SceneView s={s} t={t} first={i === 0} captions={captions} frames={frames} />
            </TransitionSeries.Sequence>
          );
          if (i === n - 1) return [seq];
          const pres = i % 2 ? fade() : slide({ direction: "from-right" });
          return [seq, <TransitionSeries.Transition key={`t${i}`} presentation={pres} timing={linearTiming({ durationInFrames: TRANSITION })} />];
        })}
      </TransitionSeries>
      {p.music ? <Audio src={p.music} volume={0.1} loop /> : null}
      <Chrome t={t} brand={p.brand} />
    </AbsoluteFill>
  );
};
