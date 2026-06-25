'use client';

import { Search, Menu, Sun, Moon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/components/ThemeProvider';
import { NotificationsBell } from '@/components/NotificationsBell';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = formData.get('search')?.toString() || '';
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || user?.email || 'Usuário';
  const initials =
    `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() ||
    'U';
  const avatarUrl: string | undefined = user?.user_metadata?.avatar_url;

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:gap-4 sm:px-6">
      <button onClick={onMenuClick} className="text-muted hover:text-fg lg:hidden" aria-label="Abrir menu">
        <Menu className="h-6 w-6" />
      </button>

      <form className="relative flex max-w-md flex-1" onSubmit={handleSearch}>
        <Search className="pointer-events-none absolute inset-y-0 left-0 h-full w-5 text-muted" aria-hidden="true" />
        <input
          className="block h-full w-full bg-transparent pl-7 text-sm text-fg outline-none placeholder:text-muted"
          placeholder="Buscar contatos, negócios, tarefas..."
          type="search"
          name="search"
          defaultValue={searchParams.get('q') || ''}
        />
      </form>

      <button onClick={toggle} className="text-muted transition-colors hover:text-fg" aria-label="Alternar tema">
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      <NotificationsBell />

      <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      <div className="flex items-center gap-2">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={fullName} className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
            {initials}
          </div>
        )}
        <span className="hidden text-sm font-semibold text-fg lg:block">{fullName}</span>
      </div>
    </header>
  );
}
