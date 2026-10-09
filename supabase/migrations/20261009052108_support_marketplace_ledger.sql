-- Ledger-only origin for owner-confirmed marketplace payouts.
-- Preserve contact gateway constraints, webhook allowlists, grants and RLS.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_gateway_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_gateway_check
  CHECK (gateway IN ('stripe', 'asaas', 'mercadopago', 'cakto', 'pix', '99freelas'));
COMMENT ON COLUMN public.payment_transactions.gateway IS
  'Origem do recebimento: gateway integrado, Pix direto ou repasse 99Freelas confirmado manualmente. Origens manuais nao habilitam ingestao automatica.';
COMMENT ON COLUMN public.payment_transactions.external_id IS
  'ID estavel no provedor; em recebimento manual sem ID bancario/provedor, chave operacional manual:task:<uuid>, nunca apresentada como identificador bancario.';
