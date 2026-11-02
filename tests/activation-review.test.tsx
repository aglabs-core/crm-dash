import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivationReview } from '@/components/activation-review';
import type { ProductMetricsResult } from '@/lib/product-metrics';

const result: ProductMetricsResult = { status: 'ok', checkedAt: '2026-11-02T04:00:00Z', message: '', via: 'crm', data: { version: 1, product: 'barberias', generatedAt: '2026-11-02T04:00:00Z', window: { from: '2026-10-03T04:00:00Z', to: '2026-11-02T04:00:00Z' }, metrics: { users: 30, accounts: 30, activeAccounts: 30, trialAccounts: 20, payingAccounts: 0, complimentaryAccounts: 10, canceledAccounts: 0, activatedAccounts: 4 }, activationFunnel: { professional: 29, catalog: 29, readyForBooking: 25, firstAppointment: 4 } } };

describe('ActivationReview', () => {
  it('highlights the largest group and explains the limits of the inventory', () => {
    render(<ActivationReview result={result} />);
    expect(screen.getByText('21')).toBeTruthy();
    expect(screen.getByText(/publicação e o compartilhamento/)).toBeTruthy();
    expect(screen.getByText(/Não indica abandono/)).toBeTruthy();
  });
  it.each(['stale', 'unavailable', 'not_configured'] as const)('does not recommend action from %s data', status => {
    const { container } = render(<ActivationReview result={{ ...result, status }} />);
    expect(container.innerHTML).toBe('');
  });
});
