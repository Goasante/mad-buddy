"use client";

import { useId, useRef, useState } from "react";

export type TrendPoint = { label: string; value: number };

const SERIES = "#E88C2B";
const AXIS = "#35312e";
const GRID = "#292724";
const MUTED = "#89847e";

const W = 600;
const H = 150;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

/**
 * Single-series area + line trend. No legend (the title names the series);
 * recessive grid/axis; a crosshair + tooltip on hover; and a visually-hidden
 * data table so the values are never color- or pixel-only.
 */
export function TrendChart({ points, unitLabel = "", ariaLabel }: { points: TrendPoint[]; unitLabel?: string; ariaLabel: string }) {
  const tableId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(1, ...points.map((point) => point.value));
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

  const x = (index: number) => PAD_X + index * stepX;
  const y = (value: number) => PAD_TOP + plotH * (1 - value / max);

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L ${x(points.length - 1).toFixed(1)} ${(PAD_TOP + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD_TOP + plotH).toFixed(1)} Z`
    : "";

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, index)));
  }

  const activePoint = active !== null ? points[active] : null;

  return (
    <div className="relative overflow-hidden rounded-[18px] bg-black/[0.08] px-2 pb-1 pt-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={tableId}
        onMouseMove={handleMove}
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={`${tableId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES} stopOpacity="0.24" />
            <stop offset="100%" stopColor={SERIES} stopOpacity="0.015" />
          </linearGradient>
        </defs>
        <line x1={PAD_X} y1={PAD_TOP + plotH} x2={W - PAD_X} y2={PAD_TOP + plotH} stroke={AXIS} strokeWidth={1} />
        <line x1={PAD_X} y1={PAD_TOP + plotH / 2} x2={W - PAD_X} y2={PAD_TOP + plotH / 2} stroke={GRID} strokeWidth={1} strokeDasharray="2 5" />

        {areaPath ? <path d={areaPath} fill={`url(#${tableId}-fill)`} /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={SERIES} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}

        {activePoint ? (
          <>
            <line x1={x(active!)} y1={PAD_TOP} x2={x(active!)} y2={PAD_TOP + plotH} stroke={MUTED} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(active!)} cy={y(activePoint.value)} r={4} fill={SERIES} stroke="#111317" strokeWidth={2} />
          </>
        ) : null}
      </svg>

      {points.length > 0 ? (
        <div className="mt-1 flex justify-between px-1 pb-1 text-[10px]" style={{ color: MUTED }}>
          <span>{points[0].label}</span>
          {points.length > 2 ? <span>{points[Math.floor(points.length / 2)].label}</span> : null}
          <span>{points[points.length - 1].label}</span>
        </div>
      ) : null}

      {activePoint ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-white/[0.10] bg-[#141518]/96 px-3 py-2 text-xs shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <span className="font-semibold tabular-nums text-white">{activePoint.value}</span>
          {unitLabel ? <span className="text-[#9a958f]"> {unitLabel}</span> : null}
          <span className="text-[#77736f]"> · {activePoint.label}</span>
        </div>
      ) : null}

      <table id={tableId} className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead><tr><th>Day</th><th>{unitLabel || "Value"}</th></tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}><td>{point.label}</td><td>{point.value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
