'use client';

import { useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** Visually shows a partial (–) state without affecting `checked`. */
  indeterminate?: boolean;
};

/**
 * Theme-aware checkbox. Uses `appearance-none` plus a brand-colored fill and an
 * overlaid check icon so the control follows the `--brand` token in both light
 * and dark mode — unlike the native `accent-color` box, which renders
 * inconsistently across browsers and ignores the theme.
 */
export function Checkbox({ indeterminate = false, checked, className, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className={cn(
          'peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-border bg-surface',
          'transition-colors checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <Check
        className="pointer-events-none absolute h-3 w-3 text-brand-contrast opacity-0 transition-opacity peer-checked:opacity-100 peer-indeterminate:opacity-0"
        strokeWidth={3.5}
      />
      {indeterminate && !checked && (
        <Minus
          className="pointer-events-none absolute h-3 w-3 text-brand-contrast"
          strokeWidth={3.5}
        />
      )}
    </span>
  );
}
