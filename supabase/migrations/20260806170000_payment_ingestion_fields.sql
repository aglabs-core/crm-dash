-- =============================================================================
-- Ingestão automática de pagamentos: origem 'compra' e rastro do gateway
--
-- O CRM passa a receber clientes direto dos webhooks de Stripe, Asaas e
-- Mercado Pago. O fluxo do n8n que faz isso está especificado no vault, em
-- "Fluxo - Ingestão de Pagamentos no CRM".
--
-- O que faltava para o insert funcionar:
--   • `origin` tinha CHECK restrito a web/prospeccao/whatsapp/manual — um
--     contato vindo de gateway falhava na constraint;
--   • não havia como saber de qual gateway veio, nem ligar o contato de volta
--     ao pagamento que o gerou;
--   • não havia documento (CPF/CNPJ), que é a chave forte no Asaas e no
--     Mercado Pago — o Stripe não coleta documento, e por isso a identidade
--     é uma cadeia: documento → email → telefone.
--
-- Idempotente; normaliza os dados antes de aplicar as constraints.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rastro da origem externa
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gateway     TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS documento   TEXT;

COMMENT ON COLUMN contacts.gateway     IS 'Gateway de origem, quando o contato veio de um pagamento.';
COMMENT ON COLUMN contacts.external_id IS 'Id do pagamento/assinatura no gateway. Garante idempotência da ingestão.';
COMMENT ON COLUMN contacts.documento   IS 'CPF/CNPJ. Chave forte da cadeia de identidade; só Asaas e MP fornecem.';

-- ---------------------------------------------------------------------------
-- 2. origin passa a aceitar 'compra'
--    Catch-all antes da constraint, para ela nunca falhar na aplicação.
-- ---------------------------------------------------------------------------
UPDATE contacts SET origin = 'prospeccao'
WHERE origin IS NULL
   OR origin NOT IN ('web', 'prospeccao', 'whatsapp', 'manual', 'compra');

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_origin_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_origin_check
  CHECK (origin IN ('web', 'prospeccao', 'whatsapp', 'manual', 'compra'));

-- ---------------------------------------------------------------------------
-- 3. gateway restrito aos três em uso
-- ---------------------------------------------------------------------------
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_gateway_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_gateway_check
  CHECK (gateway IS NULL OR gateway IN ('stripe', 'asaas', 'mercadopago'));

-- ---------------------------------------------------------------------------
-- 4. Idempotência da ingestão.
--    Gateway reenvia webhook — é comportamento normal, não exceção. Sem esta
--    chave, cada reenvio criaria um contato novo.
--    Sem user_id de propósito: (gateway, external_id) é a chave natural do
--    evento externo, e o mesmo pagamento não deve entrar duas vezes.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_gateway_external
  ON contacts(gateway, external_id)
  WHERE gateway IS NOT NULL AND external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Documento único por usuário, quando informado.
--    Normaliza na própria expressão, como uq_contacts_user_phone já faz:
--    '123.456.789-00' e '12345678900' são o mesmo documento.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_user_documento
  ON contacts(user_id, regexp_replace(documento, '\D', '', 'g'))
  WHERE documento IS NOT NULL AND documento <> '';
