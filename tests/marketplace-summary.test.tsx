import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MarketplaceSummary } from '@/components/marketplace-summary';

it('shows marketplace units with the admin definitions and limits', () => {
  render(<MarketplaceSummary data={{
    version: 1, currency: 'BRL', basis: 'platform_financial_report_and_producer_status',
    currentMonth: { from: '2026-10-01T03:00:00.000Z', grossCents: 125000, platformFeeCents: 9800, paidItems: 14 },
    previousMonth: { from: '2026-09-01T03:00:00.000Z', to: '2026-10-01T03:00:00.000Z', grossCents: 90000, platformFeeCents: 7200, paidItems: 9 },
    producers: { onboarding: 40, approved: 12 }, users: { total: 230, new30d: 31 },
  }} />);
  expect(screen.getByText('Faturamento bruto no mês')).toBeTruthy();
  expect(screen.getByText(/14 vendas/)).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  expect(screen.getByText(/de 40 com cadastro iniciado/)).toBeTruthy();
  expect(screen.getByText(/não liquidados/)).toBeTruthy();
});
