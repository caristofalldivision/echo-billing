"use client";

import { useState } from "react";

export interface RevenuePoint {
  label: string; // short axis label, e.g. "Mar 4"
  fullLabel: string; // tooltip label, e.g. "March 4, 2026"
  value: number;
}

// Hand-rolled SVG bar chart — matches the signal design system's flat/
// sharp-corner De Stijl aesthetic (no shadows, no rounded corners), which a
// packaged charting library's defaults fight against. One hue (brand blue)
// since this is a single series; per-bar hover tooltip per the interaction
// spec. Renders inline so it's naturally responsive via viewBox scaling.
export function RevenueBarChart({ data, currency }: { data: RevenuePoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padBottom = 24;
  const padTop = 12;
  const plotW = width - padLeft - 8;
  const plotH = height - padTop - padBottom;

  const max = Math.max(1, ...data.map((d) => d.value));
  // Round the axis ceiling to a clean step so gridline labels aren't ugly.
  const niceMax = (() => {
    const magnitude = Math.pow(10, Math.floor(Math.log10(max || 1)));
    const step = magnitude / 2 || 1;
    return Math.ceil(max / step) * step;
  })();

  const barW = data.length > 0 ? plotW / data.length : 0;
  const barGap = Math.min(6, barW * 0.25);

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: "auto" }}>
        {gridLines.map((f) => {
          const y = padTop + plotH * (1 - f);
          return (
            <g key={f}>
              <line x1={padLeft} x2={width} y1={y} y2={y} stroke="var(--signal-panel-border)" strokeOpacity={0.15} strokeWidth={1} />
              <text x={padLeft - 6} y={y + 3} textAnchor="end" className="fill-signal-ink-faint" fontSize={9} fontFamily="ui-monospace, monospace">
                {Math.round(niceMax * f)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const barH = niceMax > 0 ? (d.value / niceMax) * plotH : 0;
          const x = padLeft + i * barW + barGap / 2;
          const y = padTop + plotH - barH;
          const w = Math.max(1, barW - barGap);
          const isHover = hover === i;
          const showLabel = data.length <= 14 || i % Math.ceil(data.length / 14) === 0;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(0, barH)}
                fill={isHover ? "var(--signal-brand-strong)" : "var(--signal-brand)"}
                stroke="var(--signal-panel-border)"
                strokeWidth={1}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                style={{ cursor: "pointer" }}
              />
              {showLabel && (
                <text
                  x={x + w / 2}
                  y={height - padBottom + 14}
                  textAnchor="middle"
                  className="fill-signal-ink-faint"
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 border-2 border-signal-panel-border bg-signal-surface-solid px-2 py-1 text-xs"
          style={{
            left: `${((padLeft + hover * barW + barW / 2) / width) * 100}%`,
            top: 0,
            transform: "translate(-50%, -110%)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="font-bold text-signal-ink">
            {currency} {data[hover].value.toLocaleString()}
          </div>
          <div className="text-signal-ink-faint">{data[hover].fullLabel}</div>
        </div>
      )}
    </div>
  );
}
