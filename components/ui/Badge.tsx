import { cn } from '@/lib/utils';
import { TONE_BADGE, type Tone } from '@/lib/constants';

export function Badge({
  tone = 'gray',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
