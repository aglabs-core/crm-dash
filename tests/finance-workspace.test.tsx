import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FinancePage from '@/app/(dashboard)/finance/page';

const source = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/payment-data', () => ({ loadPaymentTransactions: async () => {
  if (source.fail) throw new Error('synthetic');
  return [
    { id: 'one', contact_id: 'synthetic', gateway: 'pix', external_id: 'private-reference', product: 'mecard',
      status: 'paid', amount: 300, refunded_amount: 0, net_amount: 300, currency: 'BRL', paid_at: '2026-11-01T02:00:00Z' },
    { id: 'two', contact_id: null, gateway: 'stripe', external_id: 'another-private-reference', product: 'barberias',
      status: 'paid', amount: 100, refunded_amount: 0, net_amount: 100, currency: 'USD', paid_at: null },
  ];
} }));
afterEach(() => { cleanup(); source.fail = false; });
it('filters receipt cohorts and review gaps while keeping fiscal coverage unknown', async () => {
  render(<FinancePage />);
  expect(await screen.findByText('Pagamentos · 2')).toBeTruthy();
  expect(screen.getByText(/situação fiscal dos pagamentos é desconhecida/)).toBeTruthy();
  expect(screen.queryByText('private-reference')).toBeNull();
  fireEvent.change(screen.getByLabelText('Mês do recebimento'), { target: { value: '2026-10' } });
  expect(screen.getByText('Pagamentos · 1')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Abrir cliente e histórico' }).getAttribute('href')).toBe('/contacts/synthetic');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('Pagamentos · 0')).toBeTruthy();
});
it('a failed refresh removes old totals and never declares an empty ledger', async () => {
  render(<FinancePage />);
  await screen.findByText('Pagamentos · 2');
  source.fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Valor original registrado')).toBeNull();
  expect(screen.queryByText('Pagamentos · 0')).toBeNull();
});
