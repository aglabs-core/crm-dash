import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CampaignsPage from '@/app/(dashboard)/campaigns/page';
const api = vi.hoisted(() => ({ push: vi.fn(), writes: [] as Record<string, unknown>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
  from: () => {
    let inserted = false;
    const query = {
      select: () => query, order: () => query, limit: () => query,
      insert: (payload: Record<string, unknown>) => { api.writes.push(payload); inserted = true; return query; },
      single: async () => ({ data: { id: 'synthetic-campaign' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: inserted ? { id: 'synthetic-campaign' } : [], error: null }).then(resolve),
    }; return query;
  },
} }));
afterEach(() => { cleanup(); api.writes.length = 0; api.push.mockReset(); vi.unstubAllGlobals(); });
it('campaign entry creates only a draft and opens its preparation', async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in synthetic UI tests'); }));
  const user = userEvent.setup();
  render(<CampaignsPage />);
  await screen.findByText('Nenhuma campanha registrada');
  await user.click(screen.getByRole('button', { name: 'Nova campanha' }));
  expect((screen.getByLabelText(/^Produto/) as HTMLInputElement).value).toBe('barberias');
  await user.type(screen.getByLabelText(/^Nome interno/), 'Campanha de teste');
  await user.type(screen.getByLabelText(/^Assunto/), 'Apresentação');
  await user.type(screen.getByLabelText(/^Remetente/), 'sender@example.invalid');
  await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/campaigns/synthetic-campaign'));
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({ user_id: 'synthetic-owner', product: 'barberias', provider: 'brevo', sender_email: 'sender@example.invalid' });
  expect(api.writes[0]).not.toHaveProperty('provider_campaign_id');
});
