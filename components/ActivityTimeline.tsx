'use client';

import { useState } from 'react';
import {
  StickyNote,
  Repeat,
  Sparkles,
  Megaphone,
  LifeBuoy,
  Users,
  ArrowRightLeft,
  CheckSquare,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { Activity, ActivityType } from '@/lib/types';
import { ACTIVITY_META, LOGGABLE_ACTIVITY_TYPES, TONE_HEX } from '@/lib/constants';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';

const ICONS: Record<string, LucideIcon> = {
  StickyNote,
  Repeat,
  Sparkles,
  Megaphone,
  LifeBuoy,
  Users,
  ArrowRightLeft,
  CheckSquare,
};

export function ActivityTimeline({
  activities,
  onLog,
}: {
  activities: Activity[];
  onLog: (type: ActivityType, content: string) => Promise<void>;
}) {
  const [type, setType] = useState<ActivityType>('note');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      await onLog(type, content.trim());
      setContent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {LOGGABLE_ACTIVITY_TYPES.map((t) => {
            const meta = ACTIVITY_META[t];
            const Icon = ICONS[meta.icon] ?? StickyNote;
            const active = type === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted hover:text-fg',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="Registrar uma interação..."
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={busy} disabled={!content.trim()}>
            <Send className="h-3.5 w-3.5" />
            Registrar
          </Button>
        </div>
      </form>

      {activities.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nenhuma atividade registrada ainda.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-6">
          {activities.map((a) => {
            const meta = ACTIVITY_META[a.type as ActivityType] ?? ACTIVITY_META.note;
            const Icon = ICONS[meta.icon] ?? StickyNote;
            return (
              <li key={a.id} className="relative">
                <span
                  className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface"
                  style={{ background: TONE_HEX[meta.tone] }}
                >
                  <Icon className="h-3.5 w-3.5 text-white" />
                </span>
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-xs font-semibold text-fg">{meta.label}</span>
                  <span className="text-xs text-muted">· {formatRelative(a.created_at)}</span>
                </div>
                {a.content && <p className="mt-0.5 text-sm text-muted">{a.content}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
