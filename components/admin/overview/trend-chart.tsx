"use client";

import { useId, useRef, useState } from "react";

export type TrendPoint = { label: string; value: number };

// Validated reference palette (dark surface): series-1 blue, muted axis, grid.
const SERIES = "#3987e5";
const AXIS = "#383835";
const GRID = "#2c2c2a";
const MUTED = "#898781";

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
    <div className="relative">
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
        {/* recessive baseline */}
        <line x1={PAD_X} y1={PAD_TOP + plotH} x2={W - PAD_X} y2={PAD_TOP + plotH} stroke={AXIS} strokeWidth={1} />
        {/* a single mid gridline for reference */}
        <line x1={PAD_X} y1={PAD_TOP + plotH / 2} x2={W - PAD_X} y2={PAD_TOP + plotH / 2} stroke={GRID} strokeWidth={1} strokeDasharray="2 4" />

        {areaPath ? <path d={areaPath} fill={SERIES} fillOpacity={0.12} /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}

        {activePoint ? (
          <>
            <line x1={x(active!)} y1={PAD_TOP} x2={x(active!)} y2={PAD_TOP + plotH} stroke={MUTED} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(active!)} cy={y(activePoint.value)} r={4} fill={SERIES} stroke="#0d0e10" strokeWidth={2} />
          </>
        ) : null}
      </svg>

      {/* x-axis end labels only (avoid crowding) */}
      {points.length > 0 ? (
        <div className="mt-1 flex justify-between px-1 text-[10px]" style={{ color: MUTED }}>
          <span>{points[0].label}</span>
          {points.length > 2 ? <span>{points[Math.floor(points.length / 2)].label}</span> : null}
          <span>{points[points.length - 1].label}</span>
        </div>
      ) : null}

      {activePoint ? (
        <div className="pointer-events-none absolute left-2 top-1 rounded-lg border border-white/10 bg-[#111214] px-2.5 py-1.5 text-xs shadow-lg">
          <span className="font-semibold tabular-nums">{activePoint.value}</span>
          {unitLabel ? <span className="text-muted-foreground"> {unitLabel}</span> : null}
          <span className="text-muted-foreground"> · {activePoint.label}</span>
        </div>
      ) : null}

      {/* Accessible, non-visual data table. */}
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
