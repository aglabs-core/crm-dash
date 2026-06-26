-- =============================================================================
-- Align the active funnel to the message / WhatsApp attendance flow
--
--   Lead (esperando) · Contatado · Atendimento (em conversa) ·
--   Proposta (orçamento enviado) · Pagamento (aguardando pagamento)
--   → then Cliente (ganhou) or Arquivado (não fechou).
--
-- Replaces the generic 'Negociação' with this richer flow, adding 'Atendimento'
-- and 'Pagamento'. Idempotent; safe to re-run.
-- =============================================================================

-- 'Negociação' (negotiating) → 'Pagamento' (awaiting payment): the last active
-- step before a contact becomes a client.
UPDATE contacts SET status = 'Pagamento' WHERE status = 'Negociação';

-- Catch-all so the new CHECK can never fail.
UPDATE contacts SET status = 'Lead'
WHERE status IS NULL
   OR status NOT IN ('Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo','Arquivado');

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_status_check
  CHECK (status IN ('Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo','Arquivado'));
