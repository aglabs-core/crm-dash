-- O índice misturava produtos e carregava todos os lotes/contatos no navegador.
-- Views com security_invoker preservam as políticas existentes, inclusive acesso
-- administrativo. Somente agregados alimentam os filtros e totais da carteira.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE VIEW public.contact_directory WITH (security_invoker = true) AS
SELECT c.*, regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') AS phone_digits,
  regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
  nullif(btrim(c.produto), '') AS product_key
FROM public.contacts c;

CREATE OR REPLACE VIEW public.contact_workspace_summary WITH (security_invoker = true) AS
SELECT user_id, nullif(btrim(produto), '') AS produto, origin, status, prospecting_pool, outreach_status, count(*) AS total
FROM public.contacts
GROUP BY user_id, nullif(btrim(produto), ''), origin, status, prospecting_pool, outreach_status;

CREATE OR REPLACE VIEW public.email_workspace_products WITH (security_invoker = true) AS
SELECT user_id, product FROM public.email_messages WHERE product IS NOT NULL
UNION SELECT user_id, product FROM public.email_campaigns WHERE product IS NOT NULL;

REVOKE ALL ON public.contact_directory, public.contact_workspace_summary, public.email_workspace_products FROM PUBLIC, anon;
GRANT SELECT ON public.contact_directory, public.contact_workspace_summary, public.email_workspace_products TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS contacts_directory_order_idx ON public.contacts(created_at DESC, id);
CREATE INDEX IF NOT EXISTS contacts_owner_product_order_idx ON public.contacts(user_id, (nullif(btrim(produto), '')), created_at DESC, id);
CREATE INDEX IF NOT EXISTS contacts_pipeline_order_idx ON public.contacts(user_id, status, updated_at DESC, id) WHERE prospecting_pool = false;
CREATE INDEX IF NOT EXISTS email_messages_workspace_idx ON public.email_messages(user_id, product, category, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_campaigns_workspace_idx ON public.email_campaigns(user_id, product, created_at DESC, id);
CREATE INDEX IF NOT EXISTS tasks_next_pending_idx ON public.tasks(contact_id, due_date, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS activities_last_interaction_idx ON public.activities(contact_id, created_at DESC, id)
  WHERE type IN ('followup', 'suporte', 'meeting') AND channel <> 'sistema';

NOTIFY pgrst, 'reload schema';
COMMIT;
