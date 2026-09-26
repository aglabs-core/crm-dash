'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CheckSquare,
  Settings,
  BarChart3,
  LogOut,
  Magnet,
  UserCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { label?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'Funil',
    items: [
      { name: 'Entradas do site', href: '/leads', icon: Magnet },
      { name: 'Contatos', href: '/contacts', icon: Users },
      { name: 'Funil', href: '/deals', icon: Briefcase },
      { name: 'Clientes', href: '/clients', icon: UserCheck },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { name: 'Tarefas', href: '/tasks', icon: CheckSquare },
      { name: 'Relatórios', href: '/reports', icon: BarChart3 },
    ],
  },
];

const linkClass = (active: boolean) =>
  cn(
    'group flex items-center gap-x-3 rounded-md p-2 text-sm font-medium leading-6 transition-colors',
    active ? 'bg-brand/10 text-brand' : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
  );

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <>
      <div
        className={cn('fixed inset-0 z-40 bg-black/50 lg:hidden', open ? 'block' : 'hidden')}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2 text-xl font-semibold text-fg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="AG Labs" className="h-8 w-8 object-contain" />
            CRM
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg lg:hidden" aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
          <div className="space-y-5">
            {navGroups.map((group, gi) => (
              <div key={group.label ?? `group-${gi}`}>
                {group.label && (
                  <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    {group.label}
                  </div>
                )}
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/');
                    return (
                      <li key={item.name}>
                        <Link href={item.href} onClick={onClose} className={linkClass(isActive)}>
                          <item.icon
                            className={cn('h-5 w-5 shrink-0', isActive ? 'text-brand' : 'text-muted')}
                            aria-hidden="true"
                          />
                          {item.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-auto space-y-1 pt-6">
            <Link href="/settings" onClick={onClose} className={linkClass(pathname === '/settings')}>
              <Settings
                className={cn('h-5 w-5 shrink-0', pathname === '/settings' ? 'text-brand' : 'text-muted')}
                aria-hidden="true"
              />
              Configurações
            </Link>
            <button
              onClick={handleLogout}
              className="group flex w-full items-center gap-x-3 rounded-md p-2 text-sm font-medium leading-6 text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              Sair
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
