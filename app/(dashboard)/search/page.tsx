'use client';

import { contactName, contactInitials } from '@/lib/contact-name';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Users, CheckSquare, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Contact, Task } from '@/lib/types';
import { statusTone, statusLabel, originLabel } from '@/lib/constants';
import { Card, Badge, EmptyState, PageLoader } from '@/components/ui';

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<{ contacts: Contact[]; tasks: Task[] }>({
    contacts: [],
    tasks: [],
  });

  useEffect(() => {
    if (!query) return;
    (async () => {
      setIsLoading(true);
      const like = `%${query}%`;
      const [contactsRes, tasksRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('*')
          .or(`name.ilike.${like},email.ilike.${like},company.ilike.${like}`)
          .limit(15),
        supabase.from('tasks').select('*').or(`title.ilike.${like}`).limit(10),
      ]);
      setResults({
        contacts: (contactsRes.data as Contact[]) || [],
        tasks: (tasksRes.data as Task[]) || [],
      });
      setIsLoading(false);
    })();
  }, [query]);

  if (!query) {
    return <EmptyState icon={Users} title="Digite algo para buscar" description="Busque por contatos ou tarefas." />;
  }
  if (isLoading) return <PageLoader />;

  const hasResults = results.contacts.length > 0 || results.tasks.length > 0;
  if (!hasResults) {
    return <EmptyState icon={Users} title="Nenhum resultado encontrado" description={`Não encontramos nada para "${query}".`} />;
  }

  return (
    <div className="space-y-8">
      <p className="border-b border-border pb-4 text-base font-semibold text-fg">
        Resultados para &quot;{query}&quot;
      </p>

      {results.contacts.length > 0 && (
        <section>
          <SectionHeader icon={Users} title={`Contatos (${results.contacts.length})`} href="/contacts" />
          <Card className="divide-y divide-border overflow-hidden">
            {results.contacts.map((c) => (
              <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-surface-2/50">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                    {contactInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{contactName(c.name)}</p>
                    <p className="truncate text-xs text-muted">
                      {c.email} {c.company && `· ${c.company}`} · {originLabel(c.origin)}
                    </p>
                  </div>
                </div>
                <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {results.tasks.length > 0 && (
        <section>
          <SectionHeader icon={CheckSquare} title={`Tarefas (${results.tasks.length})`} href="/tasks" />
          <Card className="divide-y divide-border overflow-hidden">
            {results.tasks.map((t) => (
              <Link key={t.id} href="/tasks" className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-surface-2/50">
                <p className={`truncate text-sm font-semibold ${t.status === 'completed' ? 'text-muted line-through' : 'text-fg'}`}>
                  {t.title}
                </p>
                <span className="shrink-0 text-xs text-muted">{t.priority}</span>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, href }: { icon: typeof Users; title: string; href: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h4 className="flex items-center gap-2 text-base font-medium text-fg">
        <Icon className="h-5 w-5 text-brand" />
        {title}
      </h4>
      <Link href={href} className="flex items-center gap-1 text-sm text-brand hover:underline">
        Ver todos <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default function SearchPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Busca Global</h1>
      <Suspense fallback={<PageLoader />}>
        <SearchContent />
      </Suspense>
    </div>
  );
}
