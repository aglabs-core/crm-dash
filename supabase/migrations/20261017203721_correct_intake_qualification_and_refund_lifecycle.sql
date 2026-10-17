-- Inbound capture was counted as sales activity and payment reversals could
-- reactivate customers. Keep neutral intake, require explicit qualification,
-- and derive the payment-backed relationship after the monotonic ledger merge.
-- Function signatures, identity resolution and existing grants are preserved.
BEGIN;
SET LOCAL lock_timeout = '5s';
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
    VALUES(tenant, 'whatsapp', NULL, NULL, NULL, p_whatsapp, 'Contato')
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

CREATE OR REPLACE FUNCTION public.maia_contact_intake(
  p_channel text,
  p_subject text,
  p_scope text,
  p_event text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  tenant constant uuid := '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
  cid uuid;
  existing_subject text;
  pid uuid;
BEGIN
  IF p_channel IS NULL OR p_channel <> 'email'
    OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 254
    OR p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 254 OR p_scope ~ '[[:cntrl:]]'
    OR p_event IS NULL OR length(p_event) NOT BETWEEN 1 AND 512 OR p_event ~ '[[:cntrl:]]'
    OR p_scope <> btrim(p_scope) OR p_event <> btrim(p_event)
  THEN
    RAISE EXCEPTION 'invalid intake';
  END IF;

  IF p_subject <> lower(p_subject)
    OR length(split_part(p_subject, '@', 1)) > 64
    OR p_subject !~ '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  THEN
    RAISE EXCEPTION 'invalid identity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text, 0));

  SELECT subject, contact_id, pending_id
  INTO existing_subject, cid, pid
  FROM maia_intake_private.events
  WHERE user_id = tenant
    AND channel = p_channel
    AND scope = p_scope
    AND event_id = p_event;

  IF FOUND THEN
    IF existing_subject <> p_subject THEN
      RAISE EXCEPTION 'event identity conflict';
    END IF;
    IF pid IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'pending',
        'contact_id', NULL,
        'pending_id', pid
      );
    END IF;

    PERFORM 1
    FROM public.contacts c
    JOIN maia_intake_private.identities i ON i.contact_id = c.id
    WHERE c.id = cid
      AND c.user_id = tenant
      AND lower(c.email) = p_subject
      AND i.user_id = tenant
      AND i.channel = p_channel
      AND i.subject = p_subject
    FOR SHARE OF c;

    IF NOT FOUND THEN
      RETURN maia_intake_private.pending_email(p_subject, p_scope, p_event);
    END IF;
    RETURN jsonb_build_object('ok', true, 'contact_id', cid);
  END IF;

  SELECT contact_id
  INTO cid
  FROM maia_intake_private.identities
  WHERE user_id = tenant
    AND channel = p_channel
    AND subject = p_subject;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.contacts
      WHERE user_id = tenant AND lower(email) = p_subject
    ) THEN
      RETURN maia_intake_private.pending_email(p_subject, p_scope, p_event);
    END IF;

    INSERT INTO public.contacts(
      user_id, name, email, phone, whatsapp, origin,
      status, plano, produto, amount
    )
    VALUES(
      tenant, NULL, p_subject, NULL, NULL, 'email',
      'Contato', NULL, NULL, NULL
    )
    RETURNING id INTO cid;

    INSERT INTO maia_intake_private.identities(user_id, channel, subject, contact_id)
    VALUES(tenant, p_channel, p_subject, cid);
  END IF;

  PERFORM 1
  FROM public.contacts
  WHERE id = cid
    AND user_id = tenant
    AND lower(email) = p_subject
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN maia_intake_private.pending_email(p_subject, p_scope, p_event);
  END IF;

  INSERT INTO maia_intake_private.events(
    user_id, channel, scope, event_id, subject, contact_id
  )
  VALUES(tenant, p_channel, p_scope, p_event, p_subject, cid);

  RETURN jsonb_build_object('ok', true, 'contact_id', cid);
END
$function$;

CREATE OR REPLACE FUNCTION public.registrar_lead_instagram(
  p_instagram_id text,
  p_username     text,
  p_codigo       text,
  p_interesse    text,
  p_canal        text,
  p_event_id     text
)
RETURNS TABLE (
  contact_id uuid,
  novo boolean,
  oferta_ja_enviada boolean,
  evento_novo boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $function$
DECLARE
  v_owner   constant uuid := '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
  v_contact uuid;
  v_event_instagram_id text;
  v_offer   boolean;
  v_new     boolean := false;
  v_user    text := NULLIF(lower(ltrim(btrim(coalesce(p_username, '')), '@')), '');
BEGIN
  IF p_instagram_id IS NULL OR p_instagram_id !~ '^[0-9]{5,40}$' THEN
    RAISE EXCEPTION 'instagram_id_invalido';
  END IF;
  IF p_canal NOT IN ('comentario', 'direct') THEN
    RAISE EXCEPTION 'canal_invalido';
  END IF;
  IF p_event_id IS NULL OR length(btrim(p_event_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'evento_invalido';
  END IF;

  -- Serializes one Meta event and one Instagram identity independently.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_canal || ':' || btrim(p_event_id), 0)
  );

  SELECT e.contact_id, e.instagram_id
  INTO v_contact, v_event_instagram_id
  FROM automation_private.instagram_events e
  WHERE e.channel = p_canal AND e.event_id = btrim(p_event_id);

  IF v_contact IS NOT NULL THEN
    IF v_event_instagram_id IS DISTINCT FROM p_instagram_id THEN
      RAISE EXCEPTION 'evento_instagram_conflitante';
    END IF;

    -- A first, pre-send call may intentionally omit enrichment. A replay with
    -- the same event can fill username/product without duplicating activity.
    UPDATE public.contacts
    SET instagram  = coalesce(v_user, instagram),
        produto    = coalesce(produto, NULLIF(btrim(p_interesse), '')),
        updated_at = now()
    WHERE id = v_contact;

    SELECT c.instagram_oferta_em IS NOT NULL
           OR EXISTS (
             SELECT 1
             FROM automation_private.instagram_offer_dispatches d
             WHERE d.instagram_id = p_instagram_id
           )
    INTO v_offer
    FROM public.contacts c
    WHERE c.id = v_contact;

    RETURN QUERY SELECT v_contact, false, coalesce(v_offer, false), false;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('instagram:' || p_instagram_id, 0)
  );

  SELECT c.id
  INTO v_contact
  FROM public.contacts c
  WHERE c.instagram_id = p_instagram_id
  FOR UPDATE;

  IF v_contact IS NULL THEN
    INSERT INTO public.contacts (
      user_id, name, instagram, instagram_id, origin, status, produto
    )
    VALUES (
      v_owner,
      coalesce('@' || v_user, 'Instagram ' || right(p_instagram_id, 6)),
      v_user,
      p_instagram_id,
      'instagram',
      'Contato',
      NULLIF(btrim(p_interesse), '')
    )
    RETURNING id INTO v_contact;
    v_new := true;
  ELSE
    UPDATE public.contacts
    SET instagram  = coalesce(v_user, instagram),
        produto    = coalesce(produto, NULLIF(btrim(p_interesse), '')),
        updated_at = now()
    WHERE id = v_contact;
  END IF;

  INSERT INTO automation_private.instagram_events (
    channel, event_id, instagram_id, contact_id
  )
  VALUES (p_canal, btrim(p_event_id), p_instagram_id, v_contact);

  INSERT INTO public.activities (user_id, contact_id, type, channel, content)
  VALUES (
    v_owner,
    v_contact,
    'note',
    'instagram',
    format(
      'Pediu o material %s pelo %s.',
      upper(coalesce(p_codigo, '?')),
      CASE p_canal WHEN 'direct' THEN 'direct' ELSE 'comentário' END
    )
  );

  SELECT c.instagram_oferta_em IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM automation_private.instagram_offer_dispatches d
           WHERE d.instagram_id = p_instagram_id
         )
  INTO v_offer
  FROM public.contacts c
  WHERE c.id = v_contact;

  RETURN QUERY SELECT v_contact, v_new, coalesce(v_offer, false), true;
END;
$function$;

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
  statuses text[] := ARRAY['Arquivado','Contato','Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo'];
  desired text;
  qualified boolean;
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
      WHERE k NOT IN ('user_id','origin','name','email','phone','whatsapp','company','produto','priority','status','commercial_intent','qualification_reason')
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

  qualified := coalesce(p_body->'commercial_intent' = 'true'::jsonb, false)
    AND length(btrim(coalesce(p_body->>'qualification_reason', ''))) BETWEEN 10 AND 500;
  desired := CASE WHEN qualified THEN p_body->>'status' ELSE 'Contato' END;
  IF old.status IN ('Cliente', 'Inativo') OR (old.status = 'Arquivado' AND NOT qualified) THEN
    desired := old.status;
  END IF;
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
        status = desired,
        prospecting_pool = CASE WHEN qualified AND desired IN ('Lead','Contatado','Atendimento','Proposta','Pagamento') THEN false ELSE prospecting_pool END
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

CREATE OR REPLACE FUNCTION public.ingest_payment_transaction(
  p_user_id uuid,
  p_gateway text,
  p_external_id text,
  p_status text,
  p_amount numeric,
  p_refunded_amount numeric DEFAULT 0,
  p_currency text DEFAULT 'BRL',
  p_product text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_documento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  normalized_gateway text := lower(btrim(p_gateway));
  normalized_external_id text := btrim(p_external_id);
  normalized_status text := lower(btrim(p_status));
  normalized_currency text := upper(btrim(p_currency));
  normalized_name text := nullif(btrim(p_name), '');
  normalized_email text := nullif(lower(btrim(p_email)), '');
  normalized_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  normalized_document text := nullif(regexp_replace(coalesce(p_documento, ''), '[^0-9]', '', 'g'), '');
  normalized_product text := nullif(btrim(p_product), '');
  candidate_ids uuid[];
  resolved_contact_id uuid;
  transaction_id uuid;
  transaction_created boolean := false;
  existing_transaction public.payment_transactions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR normalized_gateway NOT IN ('stripe', 'asaas', 'mercadopago', 'cakto')
    OR normalized_external_id IS NULL
    OR length(normalized_external_id) NOT BETWEEN 1 AND 255
    OR normalized_status NOT IN ('paid', 'partially_refunded', 'refunded', 'chargeback', 'canceled')
    OR p_amount IS NULL
    OR p_amount < 0
    OR p_refunded_amount IS NULL
    OR p_refunded_amount < 0
    OR p_refunded_amount > p_amount
    OR normalized_currency !~ '^[A-Z]{3}$'
    OR (normalized_email IS NULL AND normalized_phone IS NULL AND normalized_document IS NULL)
    OR (normalized_email IS NOT NULL AND (length(normalized_email) > 320 OR position('@' IN normalized_email) < 2))
    OR (normalized_phone IS NOT NULL AND length(normalized_phone) NOT BETWEEN 8 AND 20)
    OR (normalized_document IS NOT NULL AND length(normalized_document) > 32)
    OR (normalized_name IS NOT NULL AND length(normalized_name) > 160)
    OR (normalized_product IS NOT NULL AND length(normalized_product) > 255)
  THEN
    RAISE EXCEPTION 'invalid payment transaction';
  END IF;

  -- Serializes identity resolution for one tenant. This prevents two distinct
  -- payments for the same new buyer from creating two contacts concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT *
  INTO existing_transaction
  FROM public.payment_transactions
  WHERE user_id = p_user_id
    AND gateway = normalized_gateway
    AND external_id = normalized_external_id
  FOR UPDATE;

  IF existing_transaction.id IS NOT NULL
    AND (
      existing_transaction.currency IS DISTINCT FROM normalized_currency
      OR existing_transaction.amount IS DISTINCT FROM p_amount
    )
  THEN
    RAISE EXCEPTION 'payment transaction amount or currency conflict';
  END IF;

  IF existing_transaction.id IS NULL AND normalized_status <> 'paid' THEN
    RAISE EXCEPTION 'payment transaction not found for reversal';
  END IF;

  resolved_contact_id := existing_transaction.contact_id;

  IF resolved_contact_id IS NULL THEN
    SELECT array_agg(DISTINCT contacts.id ORDER BY contacts.id)
    INTO candidate_ids
    FROM public.contacts
    WHERE contacts.user_id = p_user_id
      AND (
        (normalized_document IS NOT NULL AND regexp_replace(coalesce(contacts.documento, ''), '[^0-9]', '', 'g') = normalized_document)
        OR (normalized_email IS NOT NULL AND lower(contacts.email) = normalized_email)
        OR (normalized_phone IS NOT NULL AND (
          regexp_replace(coalesce(contacts.phone, ''), '[^0-9]', '', 'g') = normalized_phone
          OR regexp_replace(coalesce(contacts.whatsapp, ''), '[^0-9]', '', 'g') = normalized_phone
        ))
      );

    IF cardinality(candidate_ids) > 1 THEN
      RAISE EXCEPTION 'ambiguous payment identity';
    END IF;

    resolved_contact_id := candidate_ids[1];
  END IF;

  IF resolved_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      user_id, name, email, phone, documento, origin, status, produto,
      amount, gateway, external_id
    )
    VALUES (
      p_user_id,
      coalesce(normalized_name, 'Cliente ' || right(normalized_external_id, 8)),
      normalized_email,
      normalized_phone,
      normalized_document,
      'compra',
      'Cliente',
      normalized_product,
      0,
      normalized_gateway,
      normalized_external_id
    )
    RETURNING id INTO resolved_contact_id;
  ELSE
    UPDATE public.contacts
    SET name = coalesce(name, normalized_name),
        email = coalesce(email, normalized_email),
        phone = coalesce(phone, normalized_phone),
        documento = coalesce(documento, normalized_document),
        origin = coalesce(origin, 'compra'),
        status = 'Cliente',
        produto = coalesce(normalized_product, produto),
        gateway = normalized_gateway,
        external_id = normalized_external_id,
        updated_at = now()
    WHERE id = resolved_contact_id
      AND user_id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment contact scope conflict';
    END IF;
  END IF;

  INSERT INTO public.payment_transactions (
    user_id, contact_id, gateway, external_id, status, product,
    currency, amount, refunded_amount, paid_at
  )
  VALUES (
    p_user_id, resolved_contact_id, normalized_gateway,
    normalized_external_id, normalized_status, normalized_product,
    normalized_currency, p_amount, p_refunded_amount,
    coalesce(p_paid_at, CASE WHEN normalized_status = 'paid' THEN now() END)
  )
  ON CONFLICT (user_id, gateway, external_id)
  DO UPDATE SET
    contact_id = coalesce(public.payment_transactions.contact_id, excluded.contact_id),
    status = CASE
      WHEN CASE public.payment_transactions.status
        WHEN 'paid' THEN 1 WHEN 'partially_refunded' THEN 2
        WHEN 'canceled' THEN 3 WHEN 'refunded' THEN 4 WHEN 'chargeback' THEN 4
      END
      > CASE excluded.status
        WHEN 'paid' THEN 1 WHEN 'partially_refunded' THEN 2
        WHEN 'canceled' THEN 3 WHEN 'refunded' THEN 4 WHEN 'chargeback' THEN 4
      END
      THEN public.payment_transactions.status
      ELSE excluded.status
    END,
    product = coalesce(excluded.product, public.payment_transactions.product),
    currency = excluded.currency,
    amount = greatest(public.payment_transactions.amount, excluded.amount),
    refunded_amount = greatest(public.payment_transactions.refunded_amount, excluded.refunded_amount),
    paid_at = coalesce(public.payment_transactions.paid_at, excluded.paid_at)
  RETURNING id, (xmax = 0)
  INTO transaction_id, transaction_created;

  UPDATE public.contacts
  SET amount = coalesce((
        SELECT sum(payment_transactions.net_amount)
        FROM public.payment_transactions
        WHERE payment_transactions.user_id = p_user_id
          AND payment_transactions.contact_id = resolved_contact_id
          AND payment_transactions.status IN ('paid', 'partially_refunded')
      ), 0),
      status = CASE WHEN EXISTS (
        SELECT 1 FROM public.payment_transactions p
        WHERE p.user_id = p_user_id AND p.contact_id = resolved_contact_id
          AND p.status IN ('paid', 'partially_refunded') AND p.net_amount > 0
      ) THEN 'Cliente' ELSE 'Inativo' END,
      updated_at = now()
  WHERE id = resolved_contact_id
    AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', transaction_id,
    'contact_id', resolved_contact_id,
    'created', transaction_created
  );
END
$function$;
COMMIT;
