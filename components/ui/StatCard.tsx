import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Change } from '@/lib/format';
import { Card } from './Card';

export function StatCard({
  label,
  value,
  icon: Icon,
  change,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  change?: Change | null;
  hint?: string;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        {Icon && <Icon className="h-5 w-5 text-muted/70" />}
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-fg">{value}</div>
      <div className="mt-2 flex min-h-5 items-center gap-1 text-sm">
        {change ? (
          <>
            {change.type === 'positive' ? (
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
            ) : change.type === 'negative' ? (
              <ArrowDownRight className="h-4 w-4 text-red-500" />
            ) : null}
            <span
              className={cn(
                'font-medium',
                change.type === 'positive' && 'text-emerald-600 dark:text-emerald-400',
                change.type === 'negative' && 'text-red-600 dark:text-red-400',
                change.type === 'neutral' && 'text-muted',
              )}
            >
              {change.text}
            </span>
            {hint && <span className="ml-1 text-muted">{hint}</span>}
          </>
        ) : hint ? (
          <span className="text-muted">{hint}</span>
        ) : null}
      </div>
    </Card>
  );
}
