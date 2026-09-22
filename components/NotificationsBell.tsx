'use client';

import { contactName } from '@/lib/contact-name';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, CalendarClock, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Task, Contact } from '@/lib/types';
import { isTaskOverdue, closingSoon } from '@/lib/analytics';
import { formatDate } from '@/lib/format';

type Item = { id: string; label: string; meta: string };

function Section({
  title,
  icon: Icon,
  href,
  items,
  onNav,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  items: Item[];
  onNav: () => void;
}) {
  return (
    <div className="p-2">
      <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {items.map((it) => (
        <Link
          key={it.id}
          href={href}
          onClick={onNav}
          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
        >
          <span className="truncate text-fg">{it.label}</span>
          <span className="shrink-0 text-xs text-muted">{it.meta}</span>
        </Link>
      ))}
    </div>
  );
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [closing, setClosing] = useState<Contact[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [tasksRes, contactsRes] = await Promise.all([
        supabase.from('tasks').select('id, title, due_date, status').eq('status', 'pending'),
        supabase.from('contacts').select('id, name, expected_close_date, status'),
      ]);
      setOverdue(((tasksRes.data as Task[]) || []).filter(isTaskOverdue));
      setClosing(closingSoon((contactsRes.data as Contact[]) || [], 7));
    })();
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const total = overdue.length + closing.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 divide-y divide-border rounded-xl border border-border bg-surface shadow-xl">
          {total === 0 ? (
            <p className="p-6 text-center text-sm text-muted">Tudo em dia 🎉</p>
          ) : (
            <>
              {overdue.length > 0 && (
                <Section
                  title="Tarefas vencidas"
                  icon={AlertTriangle}
                  href="/tasks"
                  items={overdue.slice(0, 4).map((t) => ({ id: t.id, label: t.title, meta: formatDate(t.due_date) }))}
                  onNav={() => setOpen(false)}
                />
              )}
              {closing.length > 0 && (
                <Section
                  title="Fechando em breve"
                  icon={CalendarClock}
                  href="/deals"
                  items={closing
                    .slice(0, 4)
                    .map((c) => ({ id: c.id, label: contactName(c.name), meta: formatDate(c.expected_close_date) }))}
                  onNav={() => setOpen(false)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
