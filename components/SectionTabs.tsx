'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sectionOf, tabsFor } from '@/lib/navigation';

export function SectionTabs() {
  const pathname = usePathname();
  const tabs = tabsFor(pathname);
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label={`Telas de ${sectionOf(pathname)?.label ?? 'seção'}`}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface px-4 sm:px-6"
    >
      {tabs.map((tab) => {
        const active = tab.href === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
