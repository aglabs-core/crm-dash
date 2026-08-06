-- =============================================================================
-- Consolidar o histórico de interações em `activities`
--
-- O CRM nasceu como banco operado por agente (tabela `interacoes`) e depois
-- virou aplicação (tabela `activities`). Hoje:
--   • `interacoes` tem 230 registros reais de contato, todos por WhatsApp;
--   • `activities` tem 83 registros e **todos são `stage_change`** — ou seja,
--     só o log automático do trigger. Nenhuma interação humana ou de agente.
--
-- Não são dois históricos concorrentes: é um histórico só, na tabela errada,
-- e ainda por cima invisível (RLS ligada sem nenhuma política).
--
-- Junto disso, corrige um erro de modelagem de `activities`: `call` e `email`
-- eram *canais*, não tipos. O que separa "o quê" de "por onde" passa a ser:
--   type    = intenção (nota, followup, boas_vindas, disparo, suporte, ...)
--   channel = meio    (whatsapp, email, telefone, presencial, sistema)
--
-- Idempotente. Não remove `interacoes` — a remoção fica para depois da
-- conferência na aplicação.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canal
-- ---------------------------------------------------------------------------
ALTER TABLE activities ADD COLUMN IF NOT EXISTS channel TEXT;
COMMENT ON COLUMN activities.channel IS 'Meio pelo qual a interação aconteceu. NULL quando não se aplica.';

UPDATE activities SET channel = 'sistema'
WHERE channel IS NULL AND type = 'stage_change';

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_channel_check;
ALTER TABLE activities ADD  CONSTRAINT activities_channel_check
  CHECK (channel IS NULL OR channel IN ('whatsapp', 'email', 'telefone', 'presencial', 'sistema'));

-- ---------------------------------------------------------------------------
-- 2. Tipos: `call` e `email` viram canal; entram os quatro tipos reais.
--    Normaliza antes da constraint para ela não poder falhar.
-- ---------------------------------------------------------------------------
UPDATE activities
SET type    = 'note',
    channel = COALESCE(channel, CASE type WHEN 'call' THEN 'telefone' ELSE 'email' END)
WHERE type IN ('call', 'email');

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD  CONSTRAINT activities_type_check
  CHECK (type IN ('note', 'followup', 'boas_vindas', 'disparo', 'suporte',
                  'meeting', 'task', 'stage_change'));

-- ---------------------------------------------------------------------------
-- 3. Migrar as interações.
--    `user_id` vem do contato, não de um valor fixo: funciona hoje, com um
--    único usuário, e continua correto se o CRM ganhar mais.
--    O NOT EXISTS torna a migration reexecutável sem duplicar.
-- ---------------------------------------------------------------------------
INSERT INTO activities (user_id, contact_id, type, channel, content, created_at)
SELECT
  c.user_id,
  i.contact_id,
  CASE WHEN i.tipo IN ('followup','boas_vindas','disparo','suporte') THEN i.tipo ELSE 'note' END,
  CASE WHEN i.canal IN ('whatsapp','email','telefone','presencial') THEN i.canal ELSE NULL END,
  COALESCE(i.resumo, ''),
  i.criado_em
FROM interacoes i
JOIN contacts c ON c.id = i.contact_id
WHERE NOT EXISTS (
  SELECT 1 FROM activities a
  WHERE a.contact_id = i.contact_id
    AND a.created_at = i.criado_em
    AND a.type = CASE WHEN i.tipo IN ('followup','boas_vindas','disparo','suporte') THEN i.tipo ELSE 'note' END
);

-- ---------------------------------------------------------------------------
-- 4. `whatsapp` passa a ser a chave de contato.
--    É o campo completo (84 de 84), com formato consistente e sem duplicados;
--    `phone` tem 75% de preenchimento e guarda resíduo de scrap.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_user_whatsapp
  ON contacts(user_id, regexp_replace(whatsapp, '\D', '', 'g'))
  WHERE whatsapp IS NOT NULL AND whatsapp <> '';

COMMENT ON COLUMN contacts.whatsapp IS 'Número de contato canônico. É por onde a operação fala com o contato.';
COMMENT ON COLUMN contacts.phone    IS 'Telefone secundário, em geral resíduo de scraping. Não é chave.';
