import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ActionsPage from '@/app/(dashboard)/actions/page';
const source = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let offset = 0;
  const builder = { select: () => builder, order: () => builder, range: (from: number) => { offset = from; return builder; }, eq: () => builder, not: () => builder,
    abortSignal: async () => ({ error: source.fail ? { message: 'synthetic' } : null, data: table === 'contacts' && offset === 0 ? [
      { id: 'c', name: 'Contato sintético', produto: 'barberias', status: 'Lead' },
      { id: 'm', name: 'Outro sintético', produto: 'mecard', status: 'Proposta' },
    ] : [] }) };
  return builder;
} } }));
afterEach(() => { cleanup(); source.fail = false; });
it('filters by product and reason and opens the original contact', async () => {
  render(<ActionsPage />);
  const link = await screen.findByRole('link', { name: /Contato sintético/ });
  expect(link.getAttribute('href')).toBe('/contacts/c');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'barberias' } });
  expect(screen.queryByText('Outro sintético')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Tarefas vencidas/ }));
  expect(screen.getByText('Nenhuma ação encontrada com estes filtros.')).toBeTruthy();
});
it('a failed refresh hides prior counts instead of showing a false zero', async () => {
  render(<ActionsPage />);
  await screen.findByText('Contato sintético');
  source.fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByText('Contato sintético')).toBeNull();
  expect(screen.queryByRole('button', { name: /Sem próximo passo/ })).toBeNull();
});
