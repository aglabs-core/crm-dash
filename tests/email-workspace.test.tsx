import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CampaignsPage from '@/app/(dashboard)/campaigns/page';
import { EmailPreview } from '@/components/EmailPreview';

const api = vi.hoisted(() => ({ calls: [] as { table: string; product?: unknown; categories?: unknown; start?: number; end?: number }[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const call: typeof api.calls[number] = { table };
  let signal: AbortSignal | undefined;
  const query = {
    select: () => query, order: () => query,
    eq: (_: string, product: unknown) => { call.product = product; return query; },
    is: () => query,
    in: (_: string, categories: string[]) => { call.categories = categories; return query; },
    range: (start: number, end: number) => { call.start = start; call.end = end; return query; },
    abortSignal: (s: AbortSignal) => { signal = s; return query; },
    then: (resolve: (r: unknown) => unknown) => {
      api.calls.push(call);
      let data: unknown[] = [];
      if (table === 'email_workspace_products') data = [{ product: 'barberias' }, { product: 'mecard' }];
      if (table === 'email_source_summary' && call.product === 'barberias') {
        const prospecting = (call.categories as string[])?.includes('prospeccao');
        data = Array.from({ length: prospecting ? 40 : 1 }, (_, i) => ({ product: 'barberias',
          category: prospecting ? 'prospeccao' : 'automacao', source_key: prospecting ? `prospeccao.lote-${i + 1}` : 'barberias.trial.inicio',
          sent: 10, delivered: 8, opened: 2, clicked: 1, replied: 0, failed: 0, opted_out: 0, last_sent_at: '2026-10-22T10:00:00Z' })).slice(call.start ?? 0, (call.end ?? 0) + 1);
      }
      return Promise.resolve({ data: signal?.aborted ? [] : data, error: null }).then(resolve);
    },
  }; return query;
} } }));
afterEach(() => { cleanup(); api.calls.length = 0; });

it('separates system from prospects, paginates lots and resets when product changes', async () => {
  const user = userEvent.setup();
  render(<CampaignsPage />);
  await screen.findByText('Barberias · Boas-vindas do teste');
  expect(screen.queryByText('Prospecção · lote 1')).toBeNull();
  expect(api.calls.some((c) => c.table === 'email_campaigns')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Prospecção' }));
  await screen.findByText('Prospecção · lote 1');
  expect(screen.queryByText('Barberias · Boas-vindas do teste')).toBeNull();
  expect(screen.queryByText('Prospecção · lote 16')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Próxima' }));
  await screen.findByText('Prospecção · lote 16');
  expect(screen.queryByText('Prospecção · lote 1')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Produto em acompanhamento'), 'aglabs');
  await screen.findByText('Nenhum envio registrado neste grupo.');
  expect(screen.queryByText('Prospecção · lote 16')).toBeNull();
  await waitFor(() => expect(api.calls.some((c) => c.table === 'email_source_summary' && c.product === 'aglabs' && c.start === 0)).toBe(true));
  expect(screen.getByRole('option', { name: 'MeCard' })).toBeTruthy();
});

it('preview blocks scripts and remote pixels until explicitly requested', async () => {
  const user = userEvent.setup();
  render(<EmailPreview html='<img src="https://example.invalid/pixel"><script>alert(1)</script>' />);
  const frame = screen.getByTitle('Prévia do e-mail');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toContain("img-src data: ;");
  expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  await user.click(screen.getByRole('button', { name: 'Carregar imagens externas' }));
  expect(frame.getAttribute('srcdoc')).toContain('img-src data: https:;');
});
