-- Make Maia-created CRM records visible to the authenticated CRM administrator,
-- add deterministic WhatsApp contact intake before model execution, and allow
-- interaction updates when the sender has not supplied a name.

CREATE POLICY "admin manage all contacts"
ON public.contacts
FOR ALL
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admin manage all activities"
ON public.activities
FOR ALL
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admin manage all tasks"
ON public.tasks
FOR ALL
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admin read Maia identity pending"
ON public.maia_identity_pending
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admin read Maia email escalations"
ON public.maia_email_escalations
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.id = auth.uid()));

CREATE OR REPLACE FUNCTION public.maia_whatsapp_intake(p_whatsapp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  tenant constant uuid := '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
  cid uuid;
  ids uuid[];
  created_contact boolean := false;
BEGIN
  IF p_whatsapp IS NULL OR p_whatsapp !~ '^[0-9]{10,13}$' THEN
    RAISE EXCEPTION 'invalid WhatsApp identity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text, 0));
  LOCK TABLE public.contacts IN SHARE ROW EXCLUSIVE MODE;

  SELECT array_agg(id ORDER BY id)
  INTO ids
  FROM public.contacts
  WHERE user_id = tenant
    AND (
      regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g') = p_whatsapp
      OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = p_whatsapp
    );

  IF cardinality(ids) > 1 THEN
    RAISE EXCEPTION 'ambiguous WhatsApp phone identity';
  END IF;

  cid := ids[1];
  IF cid IS NULL THEN
    INSERT INTO public.contacts(user_id, origin, name, email, phone, whatsapp, status)
    VALUES(tenant, 'whatsapp', NULL, NULL, NULL, p_whatsapp, 'Contatado')
    RETURNING id INTO cid;
    created_contact := true;
  ELSE
    UPDATE public.contacts
    SET whatsapp = coalesce(whatsapp, p_whatsapp),
        origin = coalesce(origin, 'whatsapp'),
        updated_at = now()
    WHERE id = cid AND user_id = tenant;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', cid,
    'created', created_contact
  );
END
$function$;

REVOKE ALL ON FUNCTION public.maia_whatsapp_intake(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maia_whatsapp_intake(text) TO service_role;

CREATE OR REPLACE FUNCTION public.maia_whatsapp_contact(p_contact uuid, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  tenant constant uuid := '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
  cid uuid;
  candidate uuid;
  ids uuid[];
  claimed text;
  safe_email text;
  old public.contacts%ROWTYPE;
  statuses text[] := ARRAY['Arquivado','Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo'];
  desired text;
BEGIN
  IF p_body IS NULL
    OR jsonb_typeof(p_body) <> 'object'
    OR p_body->>'whatsapp' IS NULL
    OR p_body->>'whatsapp' !~ '^[0-9]{10,13}$'
    OR (p_body ? 'name' AND length(coalesce(p_body->>'name', '')) > 120)
    OR (p_body ? 'user_id' AND p_body->>'user_id' IS DISTINCT FROM tenant::text)
    OR (p_body->>'status') IS NULL
    OR NOT (p_body->>'status' = ANY(statuses))
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_body) k
      WHERE k NOT IN ('user_id','origin','name','email','phone','whatsapp','company','produto','priority','status')
    )
  THEN
    RAISE EXCEPTION 'invalid WhatsApp contact';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text, 0));
  LOCK TABLE public.contacts IN SHARE ROW EXCLUSIVE MODE;

  SELECT array_agg(id)
  INTO ids
  FROM public.contacts
  WHERE user_id = tenant
    AND (
      whatsapp = p_body->>'whatsapp'
      OR phone = p_body->>'phone'
      OR phone = p_body->>'whatsapp'
    );

  IF cardinality(ids) > 1 THEN
    RAISE EXCEPTION 'ambiguous WhatsApp phone identity';
  END IF;

  cid := ids[1];
  IF p_contact IS NOT NULL AND cid IS DISTINCT FROM p_contact THEN
    RAISE EXCEPTION 'WhatsApp contact scope conflict';
  END IF;
  IF cid IS NOT NULL THEN
    SELECT * INTO old FROM public.contacts WHERE id = cid;
  END IF;

  claimed := nullif(lower(p_body->>'email'), '');
  safe_email := claimed;
  IF claimed IS NOT NULL THEN
    SELECT id INTO candidate
    FROM public.contacts
    WHERE user_id = tenant
      AND lower(email) = claimed
      AND id IS DISTINCT FROM cid;

    IF candidate IS NULL
      AND cid IS NOT NULL
      AND claimed IS DISTINCT FROM old.email
      AND EXISTS (
        SELECT 1 FROM maia_intake_private.identities
        WHERE user_id = tenant AND contact_id = cid AND channel = 'email'
      )
    THEN
      candidate := cid;
    END IF;

    IF candidate IS NOT NULL THEN
      safe_email := old.email;
    END IF;
  END IF;

  desired := p_body->>'status';
  IF array_position(statuses, old.status) > array_position(statuses, desired) THEN
    desired := old.status;
  END IF;

  IF cid IS NULL THEN
    INSERT INTO public.contacts(
      user_id, origin, name, email, phone, whatsapp,
      company, produto, priority, status
    )
    VALUES(
      tenant, 'whatsapp', nullif(btrim(p_body->>'name'), ''), safe_email,
      p_body->>'phone', p_body->>'whatsapp', p_body->>'company',
      p_body->>'produto', p_body->>'priority', desired
    )
    RETURNING id INTO cid;
  ELSE
    UPDATE public.contacts
    SET name = coalesce(nullif(btrim(p_body->>'name'), ''), name),
        email = coalesce(safe_email, email),
        phone = coalesce(p_body->>'phone', phone),
        whatsapp = p_body->>'whatsapp',
        company = coalesce(p_body->>'company', company),
        produto = coalesce(p_body->>'produto', produto),
        priority = coalesce(p_body->>'priority', priority),
        status = desired
    WHERE id = cid AND user_id = tenant;
  END IF;

  IF candidate IS NOT NULL THEN
    INSERT INTO public.maia_identity_pending(
      user_id, channel, subject, claimed_email,
      candidate_contact_id, source_contact_id
    )
    VALUES(tenant, 'whatsapp', p_body->>'whatsapp', claimed, candidate, cid)
    ON CONFLICT(user_id, channel, subject, claimed_email)
    DO UPDATE SET source_contact_id = excluded.source_contact_id, status = 'pending';
  END IF;

  RETURN jsonb_build_array(jsonb_build_object('id', cid));
END
$function$;

REVOKE ALL ON FUNCTION public.maia_whatsapp_contact(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maia_whatsapp_contact(uuid, jsonb) TO service_role;
