import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ActionsPage from '@/app/(dashboard)/actions/page';
const source = vi.hoisted(() => ({ fail: false, lifecycle: false, columns: '' }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } }, error: null }) }, from: (table: string) => {
  let offset = 0;
  const builder = { select: (columns: string) => { if (table === 'email_messages') source.columns = columns; return builder; }, order: () => builder, range: (from: number) => { offset = from; return builder; }, eq: () => builder, not: () => builder,
    abortSignal: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: source.fail ? { message: 'synthetic' } : null, data: table === 'contacts' && offset === 0 ? [
      { id: 'c', name: 'Contato sintético', produto: 'barberias', status: 'Lead', account_status: source.lifecycle ? 'trial_encerrado' : null },
      { id: 'm', name: 'Outro sintético', produto: 'mecard', status: 'Proposta' },
    ] : table === 'email_messages' && offset === 0 && source.lifecycle ? [{ id: 'e', contact_id: 'c', product: 'barberias', direction: 'outbound', category: 'automacao', status: 'delivered', source_key: source.columns.includes('source_key') ? 'barberias.trial.recuperacao' : undefined, sent_at: '2020-01-01T00:00:00Z' }] : [] }).then(resolve) };
  return builder;
} } }));
afterEach(() => { cleanup(); source.fail = false; source.lifecycle = false; });
it('includes delivered lifecycle evidence in the real action consumer', async () => {
  source.lifecycle = true;
  render(<ActionsPage />);
  expect(await screen.findByText(/e-mail do ciclo de teste entregue/)).toBeTruthy();
});
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
  expect(screen.queryByRole('button', { name: /Sem tarefa manual/ })).toBeNull();
});
