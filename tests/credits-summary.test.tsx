import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CreditsSummary } from '@/components/credits-summary';

it('shows the credits model with admin definitions and unavailable sections', () => {
  render(<CreditsSummary data={{
    version: 1, currency: 'BRL', basis: 'admin_analytics_30d',
    users: { total: 500, active30d: 120, generating: 90 },
    sales: { count: 30, payingUsers: 22, revenueCents: 123456 },
    subscriptions: null,
    credits: { sold: 40000, purchased: 15000, bonus: null, consumed: 52000, refunded: 300 },
    generations: 3400,
  }} />);
  expect(screen.getByText('Receita em 30 dias')).toBeTruthy();
  expect(screen.getByText(/30 compras/)).toBeTruthy();
  expect(screen.getByText('seção indisponível no admin')).toBeTruthy();
  expect(screen.getByText(/bônus —/)).toBeTruthy();
  expect(screen.getByText(/não é liquidação/)).toBeTruthy();
});
