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
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button onClick={onMenuClick} className="text-muted hover:text-fg lg:hidden" aria-label="Abrir menu">
        <Menu className="h-6 w-6" />
      </button>

      <form
        className="relative flex w-full max-w-xs items-center rounded-lg bg-surface-2/60 px-3 lg:max-w-sm"
        onSubmit={handleSearch}
      >
        <Search className="pointer-events-none h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          className="h-9 w-full bg-transparent px-2 text-sm text-fg outline-none placeholder:text-muted"
          placeholder="Buscar..."
          type="search"
          name="search"
          defaultValue={searchParams.get('q') || ''}
        />
      </form>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          onClick={toggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Alternar tema"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <NotificationsBell />

        <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

        <div className="flex items-center gap-2 pl-1">
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
      </div>
    </header>
  );
}
