import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from './Card';

export function ChartCard({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {action ?? (Icon && <Icon className="h-5 w-5 shrink-0 text-muted/70" />)}
      </div>
      {children}
    </Card>
  );
}
