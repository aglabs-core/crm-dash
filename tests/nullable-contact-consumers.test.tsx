import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Contacts from '@/app/(dashboard)/contacts/page';
import Clients from '@/app/(dashboard)/clients/page';
import Deals from '@/app/(dashboard)/deals/page';
import Detail from '@/app/(dashboard)/contacts/[id]/page';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Only the API and Next router are replaced. Actual pages, forms, inputs,
// modal, name helpers, analytics and drag/drop components are mounted.
const api = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  writes: [] as { table: string; payload: Record<string, unknown>; id?: unknown }[],
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: vi.fn(),
    from: (table: string) => {
      let single = false;
      let write: typeof api.writes[number] | undefined;
      const query = {
        select: () => query,
        order: () => query,
        range: () => query,
        in: () => query,
        eq: (key: string, value: unknown) => { if (write && key === 'id') write.id = value; return query; },
        maybeSingle: () => { single = true; return query; },
        single: () => { single = true; return query; },
        update: (payload: Record<string, unknown>) => {
          write = { table, payload }; api.writes.push(write); return query;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const row = { ...api.row, ...write?.payload };
          return Promise.resolve({ data: table === 'contacts' ? (single ? row : [row]) : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'synthetic-null-contact' }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

beforeEach(() => {
  api.row = {
    id: 'synthetic-null-contact', user_id: 'synthetic-user', name: null,
    email: 'nullable@example.invalid', phone: null, company: 'Synthetic Company',
    status: 'Lead', origin: 'prospeccao', produto: null, amount: 0,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
  api.writes.length = 0;
  // Fail closed if a consumer escapes the API mock.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in consumer tests'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

for (const [label, Page, placeholder] of [
  ['contacts', Contacts, 'Buscar contatos...'],
  ['clients', Clients, 'Buscar clientes...'],
] as const) {
  it(`${label}: renders nullable name and searches without crashing`, async () => {
    if (label === 'clients') api.row.status = 'Cliente';
    const user = userEvent.setup();
    render(<ConfirmProvider><Page /></ConfirmProvider>);
    expect(await screen.findByText('Sem nome')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
    const search = screen.getByPlaceholderText(placeholder);
    await user.type(search, 'SYNTHETIC');
    expect(screen.getByText('Sem nome')).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'does-not-match');
    expect(screen.queryByText('Sem nome')).toBeNull();
    await user.clear(search);
    expect(screen.getByText('Sem nome')).toBeTruthy();
    expect(api.writes).toHaveLength(0);
  });
}

for (const [label, Page] of [['contacts', Contacts], ['pipeline', Deals]] as const) {
  describe(`${label} actual edit form`, () => {
    it('keeps a null name empty and submits null after editing another field', async () => {
      const user = userEvent.setup();
      render(<ConfirmProvider><Page /></ConfirmProvider>);
      expect(await screen.findByText('Sem nome')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Editar' }));
      const name = screen.getByLabelText(/^Nome/) as HTMLInputElement;
      expect(name.value).toBe('');
      expect(name.required).toBe(false);
      const company = screen.getByLabelText('Empresa');
      await user.clear(company);
      await user.type(company, 'Changed synthetic company');
      await user.click(screen.getByRole('button', { name: /^Salvar/ }));
      await waitFor(() => expect(api.writes).toHaveLength(1));
      expect(api.writes[0]).toMatchObject({
        table: 'contacts', id: 'synthetic-null-contact',
        payload: { name: null, company: 'Changed synthetic company' },
      });
      await waitFor(() => expect(screen.queryByLabelText(/^Nome/)).toBeNull());
      expect(screen.getByText('Sem nome')).toBeTruthy();
    });
  });
}

it('contact detail renders a null name and nullable initials from the API', async () => {
  render(<Detail />);
  expect(await screen.findByRole('heading', { name: 'Sem nome' })).toBeTruthy();
  expect(screen.getByText('?')).toBeTruthy();
  expect(screen.getByText('nullable@example.invalid')).toBeTruthy();
  expect(api.writes).toHaveLength(0);
});

it('promotes an interested prospect on the same contact record', async () => {
  api.row.status = 'Arquivado';
  api.row.prospecting_pool = true;
  const user = userEvent.setup();
  render(<Detail />);
  await user.click(await screen.findByRole('button', { name: /mover para Lead/ }));
  await waitFor(() => expect(api.writes[0]).toMatchObject({
    table: 'contacts', id: 'synthetic-null-contact',
    payload: { status: 'Lead', prospecting_pool: false },
  }));
  expect(await screen.findByText('Em atendimento')).toBeTruthy();
});

it('persists an explicit block on future campaigns without deleting the contact', async () => {
  const user = userEvent.setup();
  render(<ConfirmProvider><Contacts /></ConfirmProvider>);
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  await user.selectOptions(screen.getByLabelText('Revisão de abordagem'), 'blocked');
  await user.click(screen.getByRole('button', { name: /^Salvar/ }));
  await waitFor(() => expect(api.writes[0]).toMatchObject({
    table: 'contacts', id: 'synthetic-null-contact', payload: { outreach_status: 'blocked' },
  }));
});

it('prospecting queue filters without writing', async () => {
  api.row.prospecting_pool = true;
  api.row.status = 'Arquivado';
  api.row.outreach_status = 'blocked';
  const user = userEvent.setup();
  render(<ConfirmProvider><Contacts /></ConfirmProvider>);
  await screen.findByText('Sem nome');
  await user.click(screen.getByRole('button', { name: /Revisão pendente · 0/ }));
  expect(screen.queryByText('Sem nome')).toBeNull();
  await user.click(screen.getByRole('button', { name: /Não contatar · 1/ }));
  expect(screen.getByText('Sem nome')).toBeTruthy();
  expect(api.writes).toHaveLength(0);
});

it('pipeline task shortcut is enabled only after context loads', async () => {
  const user = userEvent.setup();
  render(<ConfirmProvider><Deals /></ConfirmProvider>);
  await screen.findByText('Sem nome');
  const shortcut = screen.getByRole('button', { name: 'Sem próxima tarefa' });
  await waitFor(() => expect((shortcut as HTMLButtonElement).disabled).toBe(false));
  await user.click(shortcut);
  expect(screen.getByText('Definir próxima tarefa')).toBeTruthy();
  expect(screen.getByText('Sem interação registrada')).toBeTruthy();
  expect(api.writes).toHaveLength(0);
});

it('blocked contact remains visibly blocked after leaving prospecting', async () => {
  api.row.prospecting_pool = false;
  api.row.outreach_status = 'blocked';
  render(<ConfirmProvider><Contacts /></ConfirmProvider>);
  await screen.findByText('Sem nome');
  expect(screen.getByText('Não contatar')).toBeTruthy();
  expect(api.writes).toHaveLength(0);
});

it('bulk move to Lead does not downgrade an existing client', async () => {
  api.row.status = 'Cliente';
  const user = userEvent.setup();
  render(<ConfirmProvider><Contacts /></ConfirmProvider>);
  await screen.findByText('Sem nome');
  await user.click(screen.getByRole('checkbox', { name: 'Selecionar Sem nome' }));
  await user.click(screen.getByRole('button', { name: 'Mover p/ Lead' }));
  expect(api.writes).toHaveLength(0);
});

it('changing origin clears bulk selection before hiding the contact', async () => {
  const user = userEvent.setup();
  render(<ConfirmProvider><Contacts /></ConfirmProvider>);
  await screen.findByText('Sem nome');
  await user.click(screen.getByRole('checkbox', { name: 'Selecionar Sem nome' }));
  expect(screen.getByRole('button', { name: 'Mover p/ Lead' })).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por origem' }), 'web');
  expect(screen.queryByText('Sem nome')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mover p/ Lead' })).toBeNull();
  expect(api.writes).toHaveLength(0);
});
