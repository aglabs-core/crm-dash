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
  LogOut
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '@/lib/supabase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Contatos', href: '/contacts', icon: Users },
  { name: 'Negócios', href: '/deals', icon: Briefcase },
  { name: 'Tarefas', href: '/tasks', icon: CheckSquare },
  { name: 'Relatórios', href: '/reports', icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex h-full w-64 flex-col bg-white border-r border-gray-200">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-gray-100">
        <div className="flex items-center gap-2 font-semibold text-xl text-indigo-600">
          <div className="bg-indigo-600 rounded-lg p-1.5">
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          Nexus CRM
        </div>
      </div>
      <nav className="flex flex-1 flex-col px-4 py-6 overflow-y-auto">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <div className="text-xs font-semibold leading-6 text-gray-400 uppercase tracking-wider mb-2">
              Menu
            </div>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/');
                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={cn(
                        isActive
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'text-gray-700 hover:text-indigo-600 hover:bg-gray-50',
                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-medium transition-colors'
                      )}
                    >
                      <item.icon
                        className={cn(
                          isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-indigo-600',
                          'h-5 w-5 shrink-0 transition-colors'
                        )}
                        aria-hidden="true"
                      />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
          <li className="mt-auto space-y-1">
            <Link
              href="/settings"
              className={cn(
                pathname === '/settings'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-700 hover:text-indigo-600 hover:bg-gray-50',
                'group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-medium leading-6 transition-colors'
              )}
            >
              <Settings
                className={cn(
                  pathname === '/settings' ? 'text-indigo-600' : 'text-gray-400 group-hover:text-indigo-600',
                  'h-5 w-5 shrink-0 transition-colors'
                )}
                aria-hidden="true"
              />
              Configurações
            </Link>
            <button
              onClick={handleLogout}
              className="w-full group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-medium leading-6 text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut
                className="h-5 w-5 shrink-0 text-red-500 group-hover:text-red-600 transition-colors"
                aria-hidden="true"
              />
              Sair
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
