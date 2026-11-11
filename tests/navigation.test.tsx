import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';
import { SectionTabs } from '@/components/SectionTabs';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: async () => ({ error: null }) } } }));
afterEach(() => { cleanup(); route.pathname = '/'; });

it('the sidebar lists one entry per section and marks the section of a grouped screen', () => {
  route.pathname = '/leads';
  render(<Sidebar open onClose={() => {}} />);
  const menu = within(screen.getByRole('list'));
  expect(menu.getAllByRole('link').map((link) => link.textContent)).toEqual(
    ['Visão geral', 'Contatos', 'Funil', 'Tarefas', 'E-mails', 'Financeiro'],
  );
  expect(menu.getByRole('link', { name: 'Contatos' }).getAttribute('aria-current')).toBe('true');
  expect(menu.getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current')).toBeNull();
});

it('section tabs reach every grouped screen and mark the current one', () => {
  route.pathname = '/operations';
  render(<SectionTabs />);
  const tabs = within(screen.getByRole('navigation', { name: 'Telas de Visão geral' }));
  expect(tabs.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(
    ['/', '/operations', '/ecosystem', '/reports'],
  );
  expect(tabs.getByRole('link', { name: 'Carteira' }).getAttribute('aria-current')).toBe('page');
});

it('single-screen sections and detail pages render no tab bar', () => {
  route.pathname = '/deals';
  const { container, rerender } = render(<SectionTabs />);
  expect(container.innerHTML).toBe('');
  route.pathname = '/contacts/abc';
  rerender(<SectionTabs />);
  expect(container.innerHTML).toBe('');
});
