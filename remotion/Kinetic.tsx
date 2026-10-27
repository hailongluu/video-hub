// Composition "Kinetic": video dọc kể theo nhịp (hook → các việc → cảnh báo → chốt → kêu gọi), mỗi cảnh một hình riêng.
// Học từ các bộ skill motion (iart-ai short-form-video / kinetic-typography / motion-art-direction / animation-principles,
// Mamdouh vox-explainer / paper-cut-motion): chữ hiện kiểu mask-reveal theo dòng, đổi nhịp (punch-in) mỗi 2–4 giây,
// cắt cứng + chuyển động vào cảnh, ease-out khi vào, phụ đề từng cụm 4–6 từ trong vùng an toàn 9:16.
// Hai phong cách: "vox" (giấy, halftone, dải giấy xé, chữ đặc hẹp, chuyển động "on twos" 12 hình/giây) và
// "kinetic" (nền tối, xanh chanh, chuyển động mượt, punch-in mạnh).
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, type CalculateMetadataFunction } from "remotion";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadBarlow } from "@remotion/google-fonts/BarlowCondensed";
import { loadFont as loadBVP } from "@remotion/google-fonts/BeVietnamPro";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { z } from "zod";

const oswald = loadOswald("normal", { weights: ["500", "700"], subsets: ["vietnamese", "latin"] }).fontFamily;
const barlow = loadBarlow("normal", { weights: ["700", "800"], subsets: ["vietnamese", "latin"] }).fontFamily;
const bvp = loadBVP("normal", { weights: ["500", "700", "800"], subsets: ["vietnamese", "latin"] }).fontFamily;
const mono = loadMono("normal", { weights: ["500"], subsets: ["vietnamese", "latin"] }).fontFamily;

export const KFPS = 30;
const PAD = 0.35; // giây nghỉ sau lời mỗi cảnh

const STYLES = {
  vox: {
    bg: "#ECE4D3", ink: "#141414", sub: "#4a4640", accent: "#D7322B", hi: "#F6CE45", card: "#FBF8F1", paperShadow: "0 10px 0 -2px #00000022, 0 22px 40px -18px #00000066",
    display: oswald, dw: 700, upper: true, twos: true, dark: "#141414", onDark: "#ECE4D3",
  },
  kinetic: {
    bg: "#0B0C10", ink: "#F5F5F2", sub: "#9EA3AE", accent: "#C8FF3D", hi: "#C8FF3D", card: "#16181F", paperShadow: "0 30px 60px -24px #000000",
    display: barlow, dw: 800, upper: true, twos: false, dark: "#C8FF3D", onDark: "#0B0C10",
  },
} as const;
type St = (typeof STYLES)[keyof typeof STYLES];

const cap = z.object({ text: z.string(), start: z.number(), end: z.number() });
const scene = z.object({
  kind: z.enum(["hook", "item", "warn", "risk", "takeaway", "cta"]),
  duration: z.number(),
  captions: z.array(cap),
  kicker: z.string().optional(),
  lines: z.array(z.string()).optional(),
  num: z.number().optional(),
  title: z.string().optional(),
  sub: z.string().optional(),
  prompt: z.string().optional(),
  visual: z.any().optional(),
});
export const kineticSchema = z.object({ style: z.enum(["vox", "kinetic"]), brand: z.string().optional(), scenes: z.array(scene).min(1) });
export type KineticProps = z.infer<typeof kineticSchema>;
type Scene = z.infer<typeof scene>;

const frames = (s: Scene) => Math.ceil((s.duration + PAD) * KFPS);
export const kineticMetadata: CalculateMetadataFunction<KineticProps> = ({ props }) => ({
  durationInFrames: props.scenes.reduce((n, s) => n + frames(s), 0), fps: KFPS, width: 1080, height: 1920,
});

const outExpo = Easing.bezier(0.16, 1, 0.3, 1);
const useF = (st: St) => { const f = useCurrentFrame(); return st.twos ? f - (f % 2) : f; };
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outExpo });

/** "*cả tháng*" → tô màu nhấn; giữ dấu câu. */
const parse = (t: string) => {
  const out: { w: string; em: boolean }[] = [];
  let em = false;
  for (const raw of t.split(/\s+/).filter(Boolean)) {
    const open = raw.startsWith("*");
    const hot: boolean = em || open;
    const close = /\*[.,!?:;]*$/.test(raw) && (raw.length > 1 || !open);
    em = hot && !close;
    out.push({ w: raw.replace(/\*/g, ""), em: hot });
  }
  return out;
};

/** Mask-reveal theo dòng: chữ trồi lên từ đường chân bị che (kinetic-typography: kỹ thuật bền nhất). */
const RevealLine: React.FC<{ text: string; st: St; at: number; size: number; color?: string; em?: string; align?: "left" | "center"; strip?: boolean; tilt?: number }> = ({ text, st, at, size, color, em, align = "left", strip, tilt = 0 }) => {
  const f = useF(st);
  const p = ramp(f, at, at + 14);
  const words = parse(st.upper ? text.toUpperCase() : text);
  return (
    <div style={{ overflow: "hidden", padding: `${size * 0.06}px ${strip ? size * 0.22 : 0}px ${size * 0.02}px`, alignSelf: align === "center" ? "center" : "flex-start",
      background: strip ? st.card : undefined, transform: `rotate(${tilt}deg)`, boxShadow: strip ? st.paperShadow : undefined,
      clipPath: strip ? "polygon(0 4%,6% 0,14% 5%,25% 1%,37% 4%,49% 0,61% 5%,73% 1%,86% 4%,100% 0,98% 50%,100% 100%,88% 96%,76% 100%,63% 95%,51% 100%,39% 96%,26% 100%,13% 95%,0 100%,2% 50%)" : undefined }}>
      <div style={{ transform: `translateY(${(1 - p) * 105}%)`, fontFamily: st.display, fontWeight: st.dw, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.01em", color: color ?? st.ink, whiteSpace: "nowrap", textAlign: align }}>
        {words.map((x, i) => (
          <span key={i} style={{ color: x.em ? (em ?? st.accent) : undefined }}>{x.w}{i < words.length - 1 ? " " : ""}</span>
        ))}
      </div>
    </div>
  );
};

/** Tiêu đề cảnh: tự xuống dòng, từng từ trồi lên lệch nhau. */
const Title: React.FC<{ text: string; st: St; at: number; size: number; color?: string; align?: "left" | "center" }> = ({ text, st, at, size, color, align = "left" }) => {
  const f = useF(st);
  const words = parse(st.upper ? text.toUpperCase() : text);
  return (
    <div style={{ fontFamily: st.display, fontWeight: st.dw, fontSize: size, lineHeight: 1.06, color: color ?? st.ink, textAlign: align, textWrap: "balance", letterSpacing: "-0.01em" }}>
      {words.map((x, i) => {
        const p = ramp(f, at + i * 2, at + i * 2 + 12);
        return (
          <React.Fragment key={i}>
            <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}>
              <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, color: x.em ? st.accent : undefined,
                background: x.em && st === STYLES.vox ? `linear-gradient(transparent 58%, ${st.hi} 58%, ${st.hi} 92%, transparent 92%)` : undefined }}>{x.w}</span>
            </span>{i < words.length - 1 ? " " : ""}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Card: React.FC<{ st: St; style?: React.CSSProperties; children: React.ReactNode }> = ({ st, style, children }) => (
  <div style={{ background: st.card, borderRadius: st === STYLES.vox ? 6 : 28, boxShadow: st.paperShadow, border: st === STYLES.vox ? "2px solid #14141422" : "1.5px solid #ffffff14", ...style }}>{children}</div>
);

/** Thẻ câu lệnh mẫu: gõ từng ký tự (tất định theo khung). */
const PromptCard: React.FC<{ st: St; text: string; at: number; end: number }> = ({ st, text, at, end }) => {
  const f = useF(st);
  const p = ramp(f, at, at + 10);
  const n = Math.floor(interpolate(f, [at + 6, Math.max(at + 8, end)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const caret = n < text.length || Math.floor(f / 8) % 2 === 0;
  return (
    <Card st={st} style={{ position: "absolute", left: 90, right: 90, top: 1150, padding: "26px 32px 30px", opacity: p, transform: `translateY(${(1 - p) * 60}px)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 26, color: st === STYLES.vox ? st.accent : st.accent, marginBottom: 14, letterSpacing: "0.04em" }}>
        <span>CÂU LỆNH MẪU</span><span style={{ opacity: 0.7 }}>⧉ chép</span>
      </div>
      <div style={{ fontFamily: mono, fontSize: 36, lineHeight: 1.4, color: st === STYLES.vox ? st.ink : st.ink, minHeight: 36 * 1.4 * 3 }}>
        {text.slice(0, n)}<span style={{ opacity: caret ? 1 : 0, color: st.accent }}>▍</span>
      </div>
    </Card>
  );
};

/** Đường bút đỏ khoanh quanh chữ (vox: marker vẽ dần). */
const Marker: React.FC<{ st: St; at: number; x: number; y: number; w: number; h: number }> = ({ st, at, x, y, w, h }) => {
  const f = useF(st);
  const p = ramp(f, at, at + 12);
  const len = Math.PI * (w + h);
  return (
    <svg width={w + 40} height={h + 40} style={{ position: "absolute", left: x - 20, top: y - 20, overflow: "visible" }}>
      <ellipse cx={(w + 40) / 2} cy={(h + 40) / 2} rx={w / 2 + 6} ry={h / 2 + 4} fill="none" stroke={st.accent} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={len * (1 - p)} transform={`rotate(-4 ${(w + 40) / 2} ${(h + 40) / 2})`} />
    </svg>
  );
};

// ---------- hình riêng cho từng việc ----------
const TableVisual: React.FC<{ st: St; v: any; d: number }> = ({ st, v, d }) => {
  const f = useF(st);
  const t1 = Math.round(d * 0.22);
  const shrink = ramp(f, t1, t1 + 10);
  const rows: string[][] = v.rows;
  return (
    <div style={{ position: "absolute", left: 140, right: 140, top: 560, height: 540 }}>
      <Card st={st} style={{ position: "absolute", inset: 0, padding: 36, opacity: 1 - shrink, transform: `scaleY(${1 - shrink * 0.7})`, transformOrigin: "50% 0" }}>
        <div style={{ fontFamily: mono, fontSize: 24, color: st.sub, marginBottom: 18 }}>BIÊN BẢN HỌP · 2 TRANG</div>
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} style={{ height: 14, borderRadius: 7, background: st.sub, opacity: 0.25, width: `${60 + ((i * 37) % 38)}%`, marginBottom: 22 }} />
        ))}
      </Card>
      <Card st={st} style={{ position: "absolute", inset: 0, padding: "30px 32px", opacity: shrink }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr", gap: "0 16px", fontFamily: bvp, fontSize: 30, color: st.ink }}>
          {v.head.map((h: string) => <div key={h} style={{ fontFamily: mono, fontSize: 24, color: st.accent, paddingBottom: 14, borderBottom: `3px solid ${st.ink}` }}>{h.toUpperCase()}</div>)}
          {rows.map((r, i) => {
            const p = ramp(f, t1 + 8 + i * 7, t1 + 20 + i * 7);
            return r.map((c, k) => (
              <div key={`${i}-${k}`} style={{ padding: "26px 0", borderBottom: `1px solid ${st.sub}55`, fontWeight: k ? 500 : 700, opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
                {k === 0 ? <span style={{ color: st.accent, marginRight: 12 }}>✓</span> : null}{c}
              </div>
            ));
          })}
        </div>
      </Card>
    </div>
  );
};

const RewriteVisual: React.FC<{ st: St; v: any; d: number }> = ({ st, v, d }) => {
  const f = useF(st);
  const t1 = Math.round(d * 0.3);
  const out = ramp(f, t1, t1 + 12);
  const inn = ramp(f, t1 + 6, t1 + 20);
  const strike = ramp(f, Math.round(d * 0.12), Math.round(d * 0.12) + 10);
  const body = (txt: string, hot: string[]) => txt.split(" ").map((w, i) => {
    const h = hot.some((x) => w.toLowerCase().startsWith(x));
    return <span key={i} style={{ background: h ? st.hi : undefined, color: h && st === STYLES.kinetic ? st.onDark : undefined, padding: h ? "0 6px" : undefined, borderRadius: 4 }}>{w} </span>;
  });
  return (
    <div style={{ position: "absolute", left: 110, right: 110, top: 600, height: 500 }}>
      <Card st={st} style={{ position: "absolute", left: 0, right: 0, top: 0, padding: 34, opacity: 1 - out * 0.85, filter: `blur(${out * 6}px)`, transform: `translateY(${-out * 120}px) scale(${1 - out * 0.08})` }}>
        <div style={{ fontFamily: mono, fontSize: 24, color: st.sub, marginBottom: 12 }}>BẢN NHÁP CỦA BẠN</div>
        <div style={{ position: "relative", fontFamily: bvp, fontSize: 38, lineHeight: 1.4, color: st.sub }}>
          {v.before}
          <div style={{ position: "absolute", left: 0, top: "48%", height: 6, width: `${strike * 100}%`, background: st.accent, borderRadius: 3 }} />
        </div>
      </Card>
      <Card st={st} style={{ position: "absolute", left: 0, right: 0, top: 150, padding: 34, opacity: inn, transform: `translateY(${(1 - inn) * 160}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 24, color: st.accent, marginBottom: 12 }}>AI VIẾT LẠI</div>
        <div style={{ fontFamily: bvp, fontSize: 38, lineHeight: 1.45, color: st.ink, fontWeight: 500 }}>{body(v.after, v.hot)}</div>
      </Card>
    </div>
  );
};

const SortVisual: React.FC<{ st: St; v: any; d: number }> = ({ st, v, d }) => {
  const f = useF(st);
  const t1 = Math.round(d * 0.3);
  const groups: string[] = v.groups;
  const notes: { t: string; g: number }[] = v.notes;
  const colors = st === STYLES.vox ? ["#F6CE45", "#F4A9A0", "#A9CFE8"] : ["#C8FF3D", "#FF8A5B", "#7CC4FF"];
  const slot = [0, 0, 0];
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 560, height: 560 }}>
      {groups.map((g, i) => {
        const p = ramp(f, t1 + 4, t1 + 16);
        return <div key={g} style={{ position: "absolute", left: i * 320, width: 300, top: 0, fontFamily: mono, fontSize: 26, color: st.ink, opacity: p, borderBottom: `4px solid ${colors[i]}`, paddingBottom: 10 }}>{g.toUpperCase()}</div>;
      })}
      {notes.map((n, i) => {
        const k = slot[n.g]++;
        const p = ramp(f, t1 + i * 3, t1 + 18 + i * 3);
        const sx = 40 + ((i * 173) % 560), sy = 60 + ((i * 97) % 360), sr = ((i * 53) % 24) - 12;
        const ex = n.g * 320, ey = 70 + k * 150;
        const fl = Math.sin((f + i * 11) / 9) * (1 - p) * 10;
        return (
          <div key={i} style={{ position: "absolute", left: interpolate(p, [0, 1], [sx, ex]), top: interpolate(p, [0, 1], [sy, ey]) + fl, width: 300, padding: "18px 20px",
            background: colors[n.g], color: "#141414", fontFamily: bvp, fontWeight: 700, fontSize: 30, lineHeight: 1.25, transform: `rotate(${interpolate(p, [0, 1], [sr, 0])}deg)`,
            boxShadow: "0 12px 24px -12px #0008", borderRadius: st === STYLES.vox ? 2 : 14 }}>{n.t}</div>
        );
      })}
    </div>
  );
};

// ---------- cảnh ----------
const Frame: React.FC<{ st: St; i: number; total: number; label: string; brand?: string; dark?: boolean }> = ({ st, i, total, label, brand, dark }) => (
  <div style={{ position: "absolute", left: 90, right: 90, top: 120, display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 24, letterSpacing: "0.05em", color: dark ? st.onDark : st.sub }}>
    <span>{label}</span><span>{brand ? `${brand.toUpperCase()} · ` : ""}{String(i + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}</span>
  </div>
);

const Captions: React.FC<{ st: St; s: Scene; dark?: boolean }> = ({ st, s, dark }) => {
  const f = useCurrentFrame();
  const sec = f / KFPS;
  const c = s.captions.find((x) => sec >= x.start && sec < x.end + 0.12);
  if (!c) return null;
  const words = c.text.split(/\s+/);
  const k = Math.floor(((sec - c.start) / Math.max(c.end - c.start, 0.01)) * words.length);
  const pop = spring({ frame: f - Math.round(c.start * KFPS), fps: KFPS, config: { damping: 14, stiffness: 260 } });
  const bg = st === STYLES.vox ? (dark ? st.bg : st.ink) : "#000000cc";
  const fg = st === STYLES.vox ? (dark ? st.ink : st.bg) : "#ffffff";
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 1480, display: "flex", justifyContent: "center" }}>
      <div style={{ background: bg, color: fg, fontFamily: bvp, fontWeight: 800, fontSize: 44, lineHeight: 1.25, padding: "12px 26px", borderRadius: st === STYLES.vox ? 4 : 18, textAlign: "center", transform: `scale(${0.9 + 0.1 * pop})` }}>
        {words.map((w, i) => <span key={i} style={{ color: i <= k ? (st === STYLES.vox ? (dark ? st.accent : st.hi) : st.accent) : undefined, opacity: i <= k ? 1 : 0.55 }}>{w}{i < words.length - 1 ? " " : ""}</span>)}
      </div>
    </div>
  );
};

const LABEL: Record<Scene["kind"], string> = { hook: "// câu hỏi", item: "// việc nên giao", warn: "// cảnh báo", risk: "// vì sao", takeaway: "// ghi nhớ", cta: "// làm ngay" };

const SceneView: React.FC<{ st: St; s: Scene; i: number; total: number; brand?: string }> = ({ st, s, i, total, brand }) => {
  const f = useF(st);
  const d = frames(s);
  const dark = s.kind === "warn" || s.kind === "takeaway";
  const bg = dark ? (st === STYLES.vox ? (s.kind === "warn" ? st.accent : st.ink) : (s.kind === "warn" ? "#2A0A0C" : "#000000")) : st.bg;
  const fg = dark ? (st === STYLES.vox ? st.bg : "#ffffff") : st.ink;
  // vào cảnh: vox trượt tờ giấy từ phải + nghiêng; kinetic zoom-out nhanh
  const enter = ramp(f, 0, 9);
  const punch = st === STYLES.kinetic ? spring({ frame: f - Math.round(d * 0.5), fps: KFPS, config: { damping: 12, stiffness: 200 } }) : 0;
  const tr = st === STYLES.vox
    ? `translateX(${(1 - enter) * 1080 * 0.6}px) rotate(${(1 - enter) * 4}deg)`
    : `scale(${interpolate(enter, [0, 1], [1.18, 1]) * (1 + 0.04 * punch)})`;
  const v = s.visual || {};
  return (
    <AbsoluteFill style={{ background: bg, transform: tr, opacity: st === STYLES.kinetic ? interpolate(enter, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }) : 1 }}>
      {st === STYLES.vox ? <AbsoluteFill style={{ backgroundImage: `radial-gradient(${dark ? "#ffffff22" : "#1414141c"} 1.6px, transparent 2px)`, backgroundSize: "12px 12px" }} /> : null}
      {st === STYLES.kinetic ? <AbsoluteFill style={{ background: `radial-gradient(70% 40% at 50% ${30 + 10 * Math.sin(f / 40)}%, ${dark ? "#ff3b3b22" : "#C8FF3D14"}, transparent 70%)` }} /> : null}
      <Frame st={st} i={i} total={total} label={LABEL[s.kind]} brand={brand} dark={dark} />

      {s.kind === "hook" ? (
        <div style={{ position: "absolute", left: 90, right: 90, top: 330, display: "flex", flexDirection: "column", gap: 26 }}>
          {s.kicker ? <div style={{ fontFamily: mono, fontSize: 30, color: st.accent, opacity: ramp(f, 0, 6) }}>{s.kicker}</div> : null}
          {(s.lines || []).map((l, k) => <RevealLine key={k} text={l} st={st} at={3 + k * 6} size={k === 1 ? 190 : 150} strip={st === STYLES.vox} tilt={st === STYLES.vox ? [-1.5, 1, -0.5][k % 3] : 0} />)}
          {st === STYLES.vox ? <Marker st={st} at={Math.round(d * 0.55)} x={60} y={575} w={700} h={170} /> : null}
          <div style={{ position: "relative", height: 330, marginTop: 40 }}>
            {/* lịch 30 ô: ô đã qua được gạch dần — "cả tháng" */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 10, width: 860 }}>
              {Array.from({ length: 30 }).map((_, k) => {
                const p = ramp(f, 10 + k * 1.2, 16 + k * 1.2);
                return <div key={k} style={{ height: 70, borderRadius: st === STYLES.vox ? 3 : 10, border: `2px solid ${fg}33`, background: p > 0.5 ? (st === STYLES.vox ? st.ink : "#ffffff10") : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 22, color: p > 0.5 ? (st === STYLES.vox ? st.bg : st.sub) : `${fg}55` }}>{p > 0.5 ? "✕" : k + 1}</div>;
              })}
            </div>
          </div>
        </div>
      ) : null}

      {s.kind === "item" ? (
        <>
          <div style={{ position: "absolute", left: 90, right: 90, top: 200, display: "flex", alignItems: "flex-start", gap: 34 }}>
            <div style={{ flex: "none", width: 150, height: 150, borderRadius: "50%", background: st === STYLES.vox ? st.accent : "transparent", border: st === STYLES.kinetic ? `6px solid ${st.accent}` : undefined,
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: st.display, fontWeight: st.dw, fontSize: 84, color: st === STYLES.vox ? st.bg : st.accent,
              transform: `scale(${spring({ frame: f - 2, fps: KFPS, config: { damping: 11 } })}) rotate(${st === STYLES.vox ? -6 : 0}deg)` }}>{String(s.num).padStart(2, "0")}</div>
            <div style={{ flex: 1, paddingTop: 6 }}><Title text={s.title || ""} st={st} at={4} size={76} /></div>
          </div>
          {v.type === "table" ? <TableVisual st={st} v={v} d={d} /> : null}
          {v.type === "rewrite" ? <RewriteVisual st={st} v={v} d={d} /> : null}
          {v.type === "sort" ? <SortVisual st={st} v={v} d={d} /> : null}
          {s.prompt ? <PromptCard st={st} text={s.prompt} at={Math.round(d * 0.42)} end={d - 12} /> : null}
        </>
      ) : null}

      {s.kind === "warn" ? (
        <>
          <div style={{ position: "absolute", left: 90, right: 90, top: 250 }}><Title text={s.title || ""} st={st} at={3} size={120} color={fg} /></div>
          {(() => {
            const btn = spring({ frame: f - 8, fps: KFPS, config: { damping: 12 } });
            const slam = spring({ frame: f - Math.round(d * 0.45), fps: KFPS, config: { damping: 9, stiffness: 240 } });
            const shake = slam > 0.1 && slam < 0.98 ? Math.sin(f * 3.1) * 10 * (1 - slam) : 0;
            return (
              <div style={{ position: "absolute", left: 0, right: 0, top: 820, display: "flex", justifyContent: "center", transform: `translateX(${shake}px)` }}>
                <div style={{ position: "relative", transform: `scale(${btn})` }}>
                  <div style={{ padding: "40px 110px", borderRadius: 999, background: st === STYLES.vox ? st.bg : st.accent, color: st === STYLES.vox ? st.ink : st.onDark, fontFamily: bvp, fontWeight: 800, fontSize: 78, boxShadow: "0 24px 50px -20px #000a" }}>Gửi đi ➤</div>
                  <div style={{ position: "absolute", left: -40, right: -40, top: "46%", height: 26, background: st === STYLES.vox ? st.ink : "#FF3B3B", borderRadius: 13,
                    transform: `rotate(-14deg) scaleX(${slam})` }} />
                  <div style={{ position: "absolute", right: -70, top: -120, padding: "10px 26px", border: `8px solid ${st === STYLES.vox ? st.ink : "#FF3B3B"}`, color: st === STYLES.vox ? st.ink : "#FF3B3B",
                    fontFamily: st.display, fontWeight: st.dw, fontSize: 84, transform: `rotate(12deg) scale(${interpolate(slam, [0, 1], [2.4, 1])})`, opacity: Math.min(1, slam * 2) }}>ĐỪNG</div>
                </div>
              </div>
            );
          })()}
          {s.sub ? <div style={{ position: "absolute", left: 90, right: 90, top: 1180, fontFamily: bvp, fontSize: 40, lineHeight: 1.4, color: fg, opacity: ramp(f, Math.round(d * 0.6), Math.round(d * 0.6) + 10), textAlign: "center" }}>{s.sub}</div> : null}
        </>
      ) : null}

      {s.kind === "risk" ? (() => {
        const zoom = ramp(f, Math.round(d * 0.5), Math.round(d * 0.5) + 16);
        const blink = Math.floor(f / 6) % 2 === 0;
        return (
          <>
            <div style={{ position: "absolute", left: 90, right: 90, top: 200 }}><Title text={s.title || ""} st={st} at={3} size={96} /></div>
            <div style={{ position: "absolute", left: 110, right: 110, top: 560, transform: `scale(${1 + zoom * 0.45})`, transformOrigin: "30% 92%" }}>
              <Card st={st} style={{ padding: 40 }}>
                <div style={{ fontFamily: mono, fontSize: 24, color: st.sub, marginBottom: 18 }}>GỬI: SẾP · CHỦ ĐỀ: LÙI HẠN BÁO CÁO</div>
                <div style={{ fontFamily: bvp, fontSize: 38, lineHeight: 1.5, color: st.ink }}>
                  {v.before} <span style={{ background: blink && zoom < 0.5 ? "#FF3B3B" : "transparent", color: blink && zoom < 0.5 ? "#fff" : st.ink, outline: "4px solid #FF3B3B", padding: "0 8px", borderRadius: 4 }}>{v.wrong}</span> {v.after}
                </div>
                <div style={{ marginTop: 34, fontFamily: bvp, fontWeight: 800, fontSize: 40, background: zoom > 0.3 ? st.hi : "transparent", display: "inline-block", padding: "2px 10px",
                  color: zoom > 0.3 && st === STYLES.kinetic ? st.onDark : st.ink }}>— {v.sign}</div>
              </Card>
            </div>
          </>
        );
      })() : null}

      {s.kind === "takeaway" ? (() => {
        const L = ramp(f, 4, 16), R = ramp(f, Math.round(d * 0.4), Math.round(d * 0.4) + 12);
        const box = (label: string, word: string, on: boolean, p: number, side: number) => (
          <div style={{ width: 430, height: 560, borderRadius: st === STYLES.vox ? 4 : 30, border: on ? "none" : `5px dashed ${fg}66`, background: on ? (st === STYLES.vox ? st.hi : st.accent) : "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, opacity: p, transform: `translateX(${(1 - p) * side * 300}px) rotate(${on ? -2 : 1}deg)` }}>
            <div style={{ fontFamily: mono, fontSize: 32, color: on ? "#141414" : `${fg}aa` }}>{label}</div>
            <div style={{ fontFamily: st.display, fontWeight: st.dw, fontSize: 150, color: on ? "#141414" : `${fg}99` }}>{word}</div>
          </div>
        );
        return (
          <>
            <div style={{ position: "absolute", left: 0, right: 0, top: 560, display: "flex", justifyContent: "center", gap: 40 }}>
              {box("AI", "NHÁP", false, L, -1)}
              {box("BẠN", "CHỐT", true, R, 1)}
            </div>
            <div style={{ position: "absolute", left: 90, right: 90, top: 250 }}><Title text={s.title || ""} st={st} at={2} size={100} color={fg} align="center" /></div>
          </>
        );
      })() : null}

      {s.kind === "cta" ? (() => {
        const b = spring({ frame: f - 4, fps: KFPS, config: { damping: 8 } });
        return (
          <>
            <div style={{ position: "absolute", left: 0, right: 0, top: 330, display: "flex", justifyContent: "center" }}>
              <div style={{ width: 230, height: 300, background: st.accent, clipPath: "polygon(0 0,100% 0,100% 100%,50% 78%,0 100%)", transform: `scale(${b}) translateY(${Math.sin(f / 7) * 8}px)` }} />
            </div>
            <div style={{ position: "absolute", left: 90, right: 90, top: 720 }}><Title text={s.title || ""} st={st} at={6} size={120} align="center" /></div>
            {s.sub ? <div style={{ position: "absolute", left: 90, right: 90, top: 1100, display: "flex", justifyContent: "center", opacity: ramp(f, 16, 28) }}>
              <div style={{ fontFamily: mono, fontSize: 36, padding: "16px 30px", border: `3px solid ${st.ink}`, color: st.ink, borderRadius: st === STYLES.vox ? 2 : 999 }}>{s.sub}</div>
            </div> : null}
          </>
        );
      })() : null}

      <Captions st={st} s={s} dark={dark} />
    </AbsoluteFill>
  );
};

export const Kinetic: React.FC<KineticProps> = (p) => {
  const st = STYLES[p.style];
  let from = 0;
  const total = p.scenes.reduce((n, s) => n + frames(s), 0);
  return (
    <AbsoluteFill style={{ background: st.bg }}>
      {p.scenes.map((s, i) => {
        const at = from;
        from += frames(s);
        return <Sequence key={i} from={at} durationInFrames={frames(s)}><SceneView st={st} s={s} i={i} total={p.scenes.length} brand={p.brand} /></Sequence>;
      })}
      <Progress st={st} total={total} />
    </AbsoluteFill>
  );
};

const Progress: React.FC<{ st: St; total: number }> = ({ st, total }) => {
  const f = useCurrentFrame();
  return <div style={{ position: "absolute", left: 0, top: 0, height: 10, width: `${(f / total) * 100}%`, background: st.accent }} />;
};
