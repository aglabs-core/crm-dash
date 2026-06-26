'use client';

import { useEffect, useState } from 'react';

export type DonutSegment = { label: string; value: number; color: string };

/**
 * Refined donut: segments draw in on mount, hovering a segment (or its legend
 * row) highlights it and swaps the center content. Pure SVG + CSS transitions
 * (no chart lib) so it inherits the theme tokens and stays crisp in dark mode.
 */
export function DonutChart({
  data,
  size = 168,
  strokeWidth = 22,
  centerValue,
  centerLabel,
}: {
  data: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerValue: string | number;
  centerLabel: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = size / 2 - strokeWidth / 2;
  const circ = 2 * Math.PI * radius;
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="flex w-full items-center justify-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth} />
          {data.map((seg, i) => {
            if (seg.value <= 0) return null;
            const frac = total ? seg.value / total : 0;
            const dash = mounted ? frac * circ : 0;
            const priorTotal = data.slice(0, i).reduce((s, d) => s + d.value, 0);
            const offset = (priorTotal / (total || 1)) * circ;
            const isActive = hover === i;
            return (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circ}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                onMouseEnter={() => setHover(i)}
                className="cursor-pointer transition-[stroke-dasharray,opacity] duration-700 ease-out"
                style={{
                  opacity: hover === null || isActive ? 1 : 0.35,
                  filter: isActive ? `drop-shadow(0 0 5px ${seg.color}aa)` : 'none',
                }}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tracking-tight text-fg">{active ? active.value : centerValue}</span>
          <span className="mt-0.5 max-w-[90px] truncate text-xs text-muted">{active ? active.label : centerLabel}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {data.map((seg, i) => (
          <button
            key={seg.label}
            type="button"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-2 text-sm transition-opacity"
            style={{ opacity: hover === null || hover === i ? 1 : 0.5 }}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seg.color }} />
            <span className="text-muted">{seg.label}</span>
            <span className="font-semibold tabular-nums text-fg">{seg.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
