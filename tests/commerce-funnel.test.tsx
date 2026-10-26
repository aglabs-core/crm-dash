import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CommerceFunnel } from '@/components/commerce-funnel';
import { commerceEvents, type CommerceFunnel as Funnel } from '@/lib/commerce-funnel';

it('shows commercial units, unknown coverage and the limits of event counts', () => {
  const funnel: Funnel = { version: 1, events: Object.fromEntries(commerceEvents.map(key => [key, null])) as Funnel['events'], observedFrom: null, registeredPurchases: 0, provisionedPurchases: 0, registeredCheckoutAmountCents: 0, currency: 'BRL', basis: 'anonymous_event_counts_and_registered_live_checkout_records' };
  const { container } = render(<CommerceFunnel funnel={funnel} window={{ from: '2026-10-01T00:00:00Z', to: '2026-10-26T00:00:00Z' }} />);
  expect(screen.getByText('Compras registradas')).toBeTruthy();
  expect(screen.getByText(/não representa receita líquida/)).toBeTruthy();
  expect(screen.getByText(/não comprova compra/)).toBeTruthy();
  expect(screen.getByText(/Sem cobertura de eventos/)).toBeTruthy();
  expect(container.querySelector('progress')).toBeNull();
  expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
});
