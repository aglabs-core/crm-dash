import type { Gateway, PaymentTransaction } from '@/lib/types';

// Owner-confirmed marketplace payout belongs to the ledger only.
export const MARKETPLACE_SOURCE: PaymentTransaction['gateway'] = '99freelas';
// @ts-expect-error Marketplace payout must not enable automatic ingestion.
export const NOT_AN_AUTOMATIC_GATEWAY: Gateway = '99freelas';
