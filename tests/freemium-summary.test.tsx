import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FreemiumSummary } from '@/components/freemium-summary';
import type { FreemiumMetrics } from '@/lib/freemium';

const viajeki: FreemiumMetrics = { version: 1, currency: 'BRL', basis: 'current_records_and_confirmed_payments', publishedPages: null, onlinePages: null, publishers: null, trips: 8, tripCreators: 3, subscriptionAccessUsers: 4, paidSubscriptionUsers: 2, proMonthly: null, proYearly: 2, businessMonthly: null, businessYearly: null, tripPurchases30d: 2, tripBuyers30d: 1, tripRevenueCents30d: 3980 };
afterEach(cleanup);

describe('FreemiumSummary', () => {
  it('distinguishes people from trips and displays monetary cents as reais', () => {
    const { container } = render(<FreemiumSummary data={viajeki} users={12} />);
    const items = [...container.querySelectorAll('dl > div')];
    const value = (label: string) => items.find(item => item.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
    expect(value('Pessoas que criaram viagens')).toBe('3');
    expect(value('Viagens criadas')).toBe('8');
    expect(value('Receita de roteiros avulsos · 30d')).toMatch(/39,80/);
    expect(screen.queryByText('Páginas publicadas')).toBeNull();
  });
  it('preserves confirmed zero revenue and hides unavailable revenue', () => {
    const { rerender } = render(<FreemiumSummary data={{ ...viajeki, tripRevenueCents30d: 0 }} users={12} />);
    expect(screen.getByText(/0,00/)).toBeTruthy();
    rerender(<FreemiumSummary data={{ ...viajeki, tripRevenueCents30d: null }} users={12} />);
    expect(screen.queryByText('Receita de roteiros avulsos · 30d')).toBeNull();
  });
});
