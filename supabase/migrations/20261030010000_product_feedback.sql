-- Feedback dos produtos (Members, MeCard, Barberias, Viajeki) chega ao CRM.
--
-- Problema: cada app guarda o feedback no próprio admin e ninguém vê o
-- conjunto nem quem é a pessoa no funil. Agora o backend do produto envia
-- `feedback.submitted` para /api/integrations/feedback; o CRM liga ao contato
-- pelo e-mail (sem criar contato novo), registra uma nota na linha do tempo e
-- expõe a fila pelo MCP para a Órbita, sem e-mail nem telefone.
-- O status de triagem do app continua no app; aqui o status é o da AG LABS.

CREATE TABLE IF NOT EXISTS public.product_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_key text NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 3 AND 300),
  product text NOT NULL CHECK (product ~ '^[a-z0-9-]{2,40}$'),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  account_ref text CHECK (account_ref IS NULL OR length(account_ref) <= 200),
  message text NOT NULL CHECK (length(message) BETWEEN 3 AND 2000),
  pathname text CHECK (pathname IS NULL OR (left(pathname, 1) = '/' AND length(pathname) <= 200)),
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'lido', 'resolvido', 'arquivado')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text CHECK (reviewed_by IS NULL OR length(reviewed_by) <= 60)
);

CREATE INDEX IF NOT EXISTS product_feedback_status_idx ON public.product_feedback (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS product_feedback_product_idx ON public.product_feedback (product, occurred_at DESC);
CREATE INDEX IF NOT EXISTS product_feedback_contact_idx ON public.product_feedback (contact_id, occurred_at DESC);

ALTER TABLE public.product_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_feedback_owner_select" ON public.product_feedback;
CREATE POLICY "product_feedback_owner_select" ON public.product_feedback
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.product_feedback FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.product_feedback FROM authenticated;
GRANT SELECT ON public.product_feedback TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_ingest_product_feedback(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  addr text := lower(btrim(coalesce(p->>'owner_email', '')));
  at timestamptz := (p->>'occurred_at')::timestamptz;
  product text := lower(btrim(coalesce(p->>'product', '')));
  msg text := btrim(coalesce(p->>'message', ''));
  path text := nullif(btrim(coalesce(p->>'pathname', '')), '');
  key text := p->>'event_key';
  owner uuid := crm_ledger_private.tenant();
  cid uuid; cowner uuid; fid uuid;
BEGIN
  IF coalesce(key, '') = '' OR length(key) > 300 OR product !~ '^[a-z0-9-]{2,40}$'
    OR length(msg) NOT BETWEEN 3 AND 2000 OR at IS NULL OR at > now() + interval '5 minutes'
  THEN RAISE EXCEPTION 'invalid feedback event'; END IF;
  IF path IS NOT NULL AND (left(path, 1) <> '/' OR length(path) > 200) THEN path := NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.product_feedback WHERE event_key = key) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'duplicate');
  END IF;

  -- Só liga a um contato existente; feedback não cria lead.
  IF addr ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    SELECT id, user_id INTO cid, cowner FROM public.contacts
      WHERE lower(btrim(email)) = addr ORDER BY (user_id = owner) DESC, created_at, id LIMIT 1;
  END IF;

  INSERT INTO public.product_feedback (user_id, event_key, product, contact_id, account_ref, message, pathname, occurred_at)
  VALUES (coalesce(cowner, owner), key, product, cid, left(nullif(btrim(p->>'account_ref'), ''), 200), msg, path, at)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO fid;
  IF fid IS NULL THEN RETURN jsonb_build_object('ok', true, 'status', 'duplicate'); END IF;

  IF cid IS NOT NULL THEN
    INSERT INTO public.activities (user_id, contact_id, type, channel, content)
    VALUES (cowner, cid, 'suporte', 'sistema',
      initcap(product) || ': feedback enviado pelo app' || coalesce(' (' || path || ')', '') || ' — '
      || left(msg, 400) || CASE WHEN length(msg) > 400 THEN '…' ELSE '' END);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'recorded', 'feedback_id', fid, 'contact_linked', cid IS NOT NULL);
END
$$;

CREATE OR REPLACE FUNCTION public.crm_set_product_feedback_status(p_id uuid, p_status text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE updated uuid;
BEGIN
  IF p_status NOT IN ('novo', 'lido', 'resolvido', 'arquivado') OR coalesce(btrim(p_actor), '') = '' OR length(p_actor) > 60 THEN
    RAISE EXCEPTION 'invalid feedback status';
  END IF;
  UPDATE public.product_feedback
    SET status = p_status,
        reviewed_at = CASE WHEN p_status = 'novo' THEN NULL ELSE now() END,
        reviewed_by = CASE WHEN p_status = 'novo' THEN NULL ELSE btrim(p_actor) END
    WHERE id = p_id
    RETURNING id INTO updated;
  IF updated IS NULL THEN RAISE EXCEPTION 'feedback not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', updated, 'status', p_status);
END
$$;

REVOKE ALL ON FUNCTION public.crm_ingest_product_feedback(jsonb), public.crm_set_product_feedback_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ingest_product_feedback(jsonb), public.crm_set_product_feedback_status(uuid, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
