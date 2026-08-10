import type { Gateway } from '@/lib/types';

// Compile-time contract shared with the n8n payment-ingestion workflow.
export const PAYMENT_INGESTION_GATEWAYS = [
  'stripe',
  'asaas',
  'mercadopago',
  'cakto',
] as const satisfies readonly Gateway[];
