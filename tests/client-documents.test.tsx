import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClientDocuments } from '@/components/ClientDocuments';
const state = vi.hoisted(() => ({ fail: false, owner: false }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: { id: state.owner ? 'owner' : 'other' } }) }));
vi.mock('@/lib/client-documents', async (original) => ({ ...await original<typeof import('@/lib/client-documents')>(),
  loadDocuments: async () => { if (state.fail) throw new Error('synthetic'); return { count: 1, rows: [{
    id: 'doc', contact_id: 'contact', title: 'Contrato sintético', category: 'contract', size_bytes: 100,
    created_at: '2026-11-06T12:00:00Z', competence: null, payment_id: null,
  }] }; },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    abortSignal: async () => ({ data: [], error: null }) }; return query;
} } }));
afterEach(() => { cleanup(); state.fail = false; state.owner = false; });
it('administrative contact visibility does not enable file uploads for another owner', async () => {
  render(<ClientDocuments contactId="contact" ownerId="owner" />);
  await screen.findByText('Contrato sintético');
  expect(screen.queryByRole('button', { name: 'Anexar documento' })).toBeNull();
  expect(screen.getByText(/visualização administrativa/)).toBeTruthy();
});
it('owner can attach originals and failures hide the old list instead of showing an empty folder', async () => {
  state.owner = true;
  render(<ClientDocuments contactId="contact" ownerId="owner" />);
  await screen.findByText('Contrato sintético');
  expect(screen.getByRole('button', { name: 'Anexar documento' })).toBeTruthy();
  state.fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar documentos' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Contrato sintético')).toBeNull();
  expect(screen.queryByText('Nenhum documento registrado nesta página.')).toBeNull();
});
