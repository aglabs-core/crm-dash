-- =============================================================================
-- Ingestão automática de pagamentos: incluir a Cakto nos gateways válidos.
--
-- Mantém os registros existentes e troca somente o CHECK da coluna gateway.
-- =============================================================================

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_gateway_check;

ALTER TABLE contacts ADD CONSTRAINT contacts_gateway_check
  CHECK (
    gateway IS NULL
    OR gateway IN ('stripe', 'asaas', 'mercadopago', 'cakto')
  );
