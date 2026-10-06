-- Record owner-confirmed direct Pix without pretending it came from a gateway.
-- Additive ledger support only: automated ingestion RPCs, contact gateway
-- constraints, grants, RLS, existing events and onboarding remain unchanged.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_gateway_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_gateway_check
  CHECK (gateway IN ('stripe', 'asaas', 'mercadopago', 'cakto', 'pix'));

COMMENT ON COLUMN public.payment_transactions.gateway IS
  'Origem do recebimento: gateway integrado ou pix direto confirmado manualmente. Pix direto nao habilita ingestao automatica.';
COMMENT ON COLUMN public.payment_transactions.external_id IS
  'ID estavel no provedor; para Pix manual sem ID bancario, chave operacional manual:task:<uuid>, nunca apresentada como identificador bancario.';
COMMENT ON COLUMN public.payment_transactions.paid_at IS
  'Data/hora do pagamento quando conhecida; NULL quando a confirmacao manual nao informa o horario bancario. created_at registra o lancamento, nao o pagamento.';
