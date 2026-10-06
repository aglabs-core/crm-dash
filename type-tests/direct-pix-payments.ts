import type { Gateway, PaymentTransaction } from '@/lib/types';

// Direct Pix is valid in the ledger, not an automatic provider integration.
export const DIRECT_PIX_SOURCE: PaymentTransaction['gateway'] = 'pix';
// @ts-expect-error Direct Pix must not become a webhook ingestion gateway.
export const NOT_A_WEBHOOK_GATEWAY: Gateway = 'pix';
