-- Make Instagram ingestion idempotent and offer delivery single-claim.
-- The workflow records the Meta event before writing the timeline and reserves
-- an offer before waiting/sending, so webhook retries and concurrent runs do
-- not create duplicate activities or duplicate commercial messages.

BEGIN;

CREATE SCHEMA IF NOT EXISTS automation_private;
REVOKE ALL ON SCHEMA automation_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS automation_private.instagram_events (
  channel       text        NOT NULL CHECK (channel IN ('comentario', 'direct')),
  event_id      text        NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  instagram_id  text        NOT NULL,
  contact_id    uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  received_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, event_id)
);

CREATE TABLE IF NOT EXISTS automation_private.instagram_offer_dispatches (
  instagram_id  text        PRIMARY KEY,
  contact_id    uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  interest      text,
  state         text        NOT NULL CHECK (state IN ('reserved', 'sent', 'uncertain')),
  reserved_at   timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  CHECK ((state = 'sent' AND sent_at IS NOT NULL) OR state <> 'sent')
);

-- PostgreSQL does not index foreign keys automatically; these keep contact
-- deletion/cascade and operational lookups bounded as the event log grows.
CREATE INDEX IF NOT EXISTS instagram_events_contact_id_idx
  ON automation_private.instagram_events (contact_id);
CREATE INDEX IF NOT EXISTS instagram_offer_dispatches_contact_id_idx
  ON automation_private.instagram_offer_dispatches (contact_id);

ALTER TABLE automation_private.instagram_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_private.instagram_offer_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA automation_private FROM PUBLIC, anon, authenticated;

-- Preserve the already-delivered state when deploying over the existing CRM.
INSERT INTO automation_private.instagram_offer_dispatches (
  instagram_id, contact_id, interest, state, reserved_at, sent_at
)
SELECT c.instagram_id, c.id, c.produto, 'sent', c.instagram_oferta_em, c.instagram_oferta_em
FROM public.contacts c
WHERE c.instagram_id IS NOT NULL
  AND c.instagram_oferta_em IS NOT NULL
ON CONFLICT (instagram_id) DO NOTHING;

-- This CRM has one configured tenant. Choosing the owner by row count made a
-- bulk import capable of silently changing automation ownership.
CREATE OR REPLACE FUNCTION public.crm_dono_da_base()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT '0af00833-c1f7-42f4-9543-a5e0ff6f55fc'::uuid;
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
      'Lead',
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

-- Backward-compatible wrapper for callers during the deployment window.
CREATE OR REPLACE FUNCTION public.registrar_lead_instagram(
  p_instagram_id text,
  p_username     text,
  p_codigo       text,
  p_interesse    text,
  p_canal        text
)
RETURNS TABLE (contact_id uuid, novo boolean, oferta_ja_enviada boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  SELECT r.contact_id, r.novo, r.oferta_ja_enviada
  FROM public.registrar_lead_instagram(
    p_instagram_id,
    p_username,
    p_codigo,
    p_interesse,
    p_canal,
    'legacy:' || gen_random_uuid()::text
  ) r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_oferta_instagram(
  p_instagram_id text,
  p_interesse text
)
RETURNS TABLE (reservado boolean, contact_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $function$
DECLARE
  v_contact uuid;
  v_sent_at timestamptz;
  v_claimed uuid;
BEGIN
  IF p_instagram_id IS NULL OR p_instagram_id !~ '^[0-9]{5,40}$' THEN
    RAISE EXCEPTION 'instagram_id_invalido';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer:' || p_instagram_id, 0)
  );

  SELECT c.id, c.instagram_oferta_em
  INTO v_contact, v_sent_at
  FROM public.contacts c
  WHERE c.instagram_id = p_instagram_id
  FOR UPDATE;

  IF v_contact IS NULL THEN
    RAISE EXCEPTION 'contato_instagram_inexistente';
  END IF;
  IF v_sent_at IS NOT NULL THEN
    RETURN QUERY SELECT false, v_contact;
    RETURN;
  END IF;

  INSERT INTO automation_private.instagram_offer_dispatches (
    instagram_id, contact_id, interest, state
  )
  VALUES (
    p_instagram_id, v_contact, NULLIF(btrim(p_interesse), ''), 'reserved'
  )
  ON CONFLICT (instagram_id) DO NOTHING
  RETURNING instagram_offer_dispatches.contact_id INTO v_claimed;

  RETURN QUERY SELECT v_claimed IS NOT NULL, v_contact;
END;
$function$;

CREATE OR REPLACE FUNCTION public.concluir_oferta_instagram(
  p_instagram_id text,
  p_interesse text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $function$
DECLARE
  v_contact uuid;
  v_owner uuid;
BEGIN
  UPDATE automation_private.instagram_offer_dispatches d
  SET state = 'sent',
      interest = coalesce(d.interest, NULLIF(btrim(p_interesse), '')),
      sent_at = now()
  WHERE d.instagram_id = p_instagram_id
    AND d.state = 'reserved'
  RETURNING d.contact_id INTO v_contact;

  IF v_contact IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.contacts c
  SET instagram_oferta_em = coalesce(c.instagram_oferta_em, now()),
      updated_at = now()
  WHERE c.id = v_contact
  RETURNING c.user_id INTO v_owner;

  INSERT INTO public.activities (user_id, contact_id, type, channel, content)
  VALUES (
    v_owner,
    v_contact,
    'disparo',
    'instagram',
    format(
      'Recebeu a oferta automática de %s no direct.',
      coalesce(NULLIF(btrim(p_interesse), ''), 'produto')
    )
  );

  RETURN true;
END;
$function$;

-- Keep the old post-send entry point idempotent for rollback compatibility.
CREATE OR REPLACE FUNCTION public.marcar_oferta_instagram(
  p_instagram_id text,
  p_interesse text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $function$
DECLARE
  v_contact uuid;
BEGIN
  SELECT c.id INTO v_contact
  FROM public.contacts c
  WHERE c.instagram_id = p_instagram_id;
  IF v_contact IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO automation_private.instagram_offer_dispatches (
    instagram_id, contact_id, interest, state
  )
  VALUES (
    p_instagram_id, v_contact, NULLIF(btrim(p_interesse), ''), 'reserved'
  )
  ON CONFLICT (instagram_id) DO NOTHING;

  PERFORM public.concluir_oferta_instagram(p_instagram_id, p_interesse);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_dono_da_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_lead_instagram(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_lead_instagram(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_oferta_instagram(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_oferta_instagram(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marcar_oferta_instagram(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_lead_instagram(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_lead_instagram(text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_oferta_instagram(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.concluir_oferta_instagram(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.marcar_oferta_instagram(text, text) TO service_role;

COMMIT;
