import { ImageResponse } from "next/og";

export const alt = "Godfred Ofosu Asante — Builder, Operator & Creative";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "64px 76px", background: "#f7f5ee", color: "#242522" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}><span>GOA.</span><span style={{ color: "#a34b2d" }}>BUILDER · OPERATOR · CREATIVE</span></div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 88, letterSpacing: -4, lineHeight: 1.08 }}><span>Godfred</span><span style={{ display: "flex" }}>Ofosu Asante<span style={{ color: "#a34b2d" }}>.</span></span></div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #dcdad0", paddingTop: 25, fontSize: 23 }}><span>Founder of Mad Buddy. Based in Ghana.</span><span style={{ color: "#a34b2d" }}>mad-buddy.com/godfred</span></div>
    </div>, size
  );
}
