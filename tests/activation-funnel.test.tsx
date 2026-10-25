import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivationFunnel } from '@/components/activation-funnel';
import type { ProductSnapshot } from '@/lib/product-metrics';

const snapshot: ProductSnapshot = { version: 1, product: 'barberias', generatedAt: '2026-10-25T12:00:00Z', window: { from: '2026-10-01T00:00:00Z', to: '2026-10-25T12:00:00Z' }, metrics: { users: 25, accounts: 25, activeAccounts: 22, trialAccounts: 20, payingAccounts: 0, complimentaryAccounts: 2, canceledAccounts: 0, activatedAccounts: 7 }, activationFunnel: { professional: 21, catalog: 21, readyForBooking: 21, firstAppointment: 7 } };

describe('ActivationFunnel', () => {
  it('keeps details collapsed and exposes a useful summary and explicit denominator', () => {
    const { container } = render(<ActivationFunnel snapshot={snapshot} />);
    expect(screen.getByText('Ativação · 14 prontas sem reserva')).toBeTruthy();
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
    const bars = container.querySelectorAll('progress');
    expect(bars.length).toBe(4);
    expect(bars[3].value).toBe(7);
    expect(bars[3].max).toBe(25);
    expect(screen.getByText(/Não representa conversão/)).toBeTruthy();
  });
  it('does not invent stages when the origin has not shipped the optional contract', () => {
    const { container } = render(<ActivationFunnel snapshot={{ ...snapshot, activationFunnel: undefined }} />);
    expect(container.innerHTML).toBe('');
  });
});
