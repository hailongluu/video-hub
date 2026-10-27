import React from "react";
import { Composition } from "remotion";
import { Explainer, explainerSchema, explainerMetadata, type ExplainerProps } from "./Explainer";
import { Kinetic, kineticSchema, kineticMetadata } from "./Kinetic";

const sample: ExplainerProps = {
  title: "Ba mẹo dùng ChatGPT",
  aspect: "9:16",
  theme: "midnight",
  brand: "luuhailong.com",
  scenes: [
    { heading: "Ba mẹo dùng ChatGPT", text: "Ba mẹo dùng ChatGPT để viết email nhanh gấp đôi.", emoji: "⚡", duration: 3.7, captions: [] },
    {
      heading: "Mẹo 1: Cho bối cảnh",
      text: "Hãy nói rõ bạn là ai, gửi cho ai, và muốn người đọc làm gì.",
      bullets: ["Bạn là ai", "Gửi cho ai", "Mục tiêu"],
      duration: 4.5,
      captions: [],
    },
  ],
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="Explainer"
    component={Explainer}
    schema={explainerSchema}
    defaultProps={sample}
    calculateMetadata={explainerMetadata}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={300}
  />
  <Composition
    id="Kinetic"
    component={Kinetic}
    schema={kineticSchema}
    defaultProps={{ style: "vox", scenes: [{ kind: "hook", duration: 3, captions: [], lines: ["Thử", "*kinetic*"] }] }}
    calculateMetadata={kineticMetadata}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={300}
  />
  </>
);
