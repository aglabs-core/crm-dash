-- Attribute deterministic email-intake contacts to the email channel and
-- repair existing canonical email contacts whose origin was left null.

ALTER TABLE public.contacts DROP CONSTRAINT contacts_origin_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_origin_check
CHECK (origin = ANY (ARRAY['web', 'prospeccao', 'whatsapp', 'email', 'manual', 'compra']));

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
      'Contatado', NULL, NULL, NULL
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

UPDATE public.contacts AS c
SET origin = 'email', updated_at = now()
WHERE c.user_id = '0af00833-c1f7-42f4-9543-a5e0ff6f55fc'
  AND c.origin IS NULL
  AND EXISTS (
    SELECT 1
    FROM maia_intake_private.identities AS i
    WHERE i.user_id = c.user_id
      AND i.contact_id = c.id
      AND i.channel = 'email'
  );
