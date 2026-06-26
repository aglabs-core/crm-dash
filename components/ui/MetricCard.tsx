import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Change } from '@/lib/format';
import { TONE_HEX, type Tone } from '@/lib/constants';

/**
 * Refined KPI card — a tone-colored icon chip, a large value and a caption,
 * with an optional trend pill and a soft corner glow in the accent color.
 * Used across the reports dashboard for a consistent, premium metric strip.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'indigo',
  hint,
  change,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  change?: Change | null;
  className?: string;
}) {
  const color = TONE_HEX[tone];

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.10] blur-2xl transition-opacity duration-300 group-hover:opacity-20"
        style={{ background: color }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset"
          style={{ background: `${color}1f`, color, borderColor: `${color}33` }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {change && <TrendPill change={change} />}
      </div>
      <div className="relative mt-4 truncate text-[26px] font-bold leading-none tracking-tight text-fg">
        {value}
      </div>
      <div className="relative mt-2 flex items-center gap-1.5">
        <span className="text-sm font-medium text-muted">{label}</span>
        {hint && <span className="truncate text-xs text-muted/70">· {hint}</span>}
      </div>
    </div>
  );
}

function TrendPill({ change }: { change: Change }) {
  const Icon =
    change.type === 'positive' ? ArrowUpRight : change.type === 'negative' ? ArrowDownRight : Minus;
  const cls =
    change.type === 'positive'
      ? 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400'
      : change.type === 'negative'
        ? 'text-red-600 bg-red-500/10 dark:text-red-400'
        : 'text-muted bg-surface-2';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold',
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {change.text}
    </span>
  );
}
