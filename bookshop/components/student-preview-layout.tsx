"use client";
import { useState } from "react";
export default function StudentPreviewLayout({ html }: { html: string }) {
  const [width, setWidth] = useState(375);
  return <>
    <div className="row"><button type="button" aria-pressed={width === 375} onClick={() => setWidth(375)}>375 px</button><button type="button" aria-pressed={width === 390} onClick={() => setWidth(390)}>390 px</button></div>
    <p>This is a real browser frame for narrow-layout inspection. It does not emulate iPhone Safari. Use the separate private reader link for provider, clipboard and phone checks.</p>
    <div style={{ overflowX: "auto", maxWidth: "100%" }}><iframe title={`Student reader at ${width} CSS pixels`} srcDoc={html} sandbox="allow-scripts" style={{ width, height: 1100, border: "1px solid #bbb", display: "block", boxSizing: "content-box" }} /></div>
  </>;
}
