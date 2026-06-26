'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type BarListItem = {
  label: string;
  /** Drives the bar width (relative to the largest item). */
  value: number;
  /** Pre-formatted value shown on the right. */
  display: string;
  /** Optional small caption next to the label. */
  sub?: string;
  /** Bar/accent color (defaults to brand). */
  color?: string;
  href?: string;
};

/**
 * Horizontal ranked/funnel bars — label + accent dot on the left, value on the
 * right, a soft colored fill as the proportional track. Reads cleanly in light
 * and dark mode and replaces the noisier Recharts bar charts for funnels and
 * "by product" rankings.
 */
export function BarList({
  items,
  emptyMessage = 'Sem dados.',
  className,
}: {
  items: BarListItem[];
  emptyMessage?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (items.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">{emptyMessage}</div>;
  }

  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className={cn('flex h-full flex-col justify-center gap-2.5', className)}>
      {items.map((it) => {
        const pct = mounted ? Math.max(3, (it.value / max) * 100) : 0;
        const color = it.color ?? 'var(--brand)';
        const Row = (
          <div className="group relative h-10 overflow-hidden rounded-lg bg-surface-2/70">
            <div
              className="absolute inset-y-0 left-0 rounded-lg opacity-[0.18] transition-all duration-700 ease-out group-hover:opacity-30"
              style={{ width: `${pct}%`, background: color }}
            />
            <div
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg transition-opacity duration-700"
              style={{ background: color }}
            />
            <div className="relative flex h-full items-center justify-between gap-3 px-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate">{it.label}</span>
                {it.sub && <span className="shrink-0 text-xs font-normal text-muted">{it.sub}</span>}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">{it.display}</span>
            </div>
          </div>
        );
        return it.href ? (
          <Link key={it.label} href={it.href} className="block">
            {Row}
          </Link>
        ) : (
          <div key={it.label}>{Row}</div>
        );
      })}
    </div>
  );
}
