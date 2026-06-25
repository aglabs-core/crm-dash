'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 'danger' = red confirm button (deletes), 'default' = brand. */
  tone?: 'danger' | 'default';
  icon?: LucideIcon;
};

type ConfirmContextType = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setBusy(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') {
        setBusy(true);
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [options, close]);

  const danger = options?.tone !== 'default';
  const Icon = options?.icon ?? AlertTriangle;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex gap-4">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  danger
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-brand/10 text-brand'
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-fg">{options.title}</h2>
                {options.description && (
                  <p className="mt-1 text-sm text-muted">{options.description}</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => close(false)}>
                {options.cancelText ?? 'Cancelar'}
              </Button>
              <Button
                variant={danger ? 'danger' : 'primary'}
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  close(true);
                }}
              >
                {options.confirmText ?? 'Confirmar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
