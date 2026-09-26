-- Convert a web form into the existing contact identity in one transaction.
-- The old browser sequence inserted first and linked the form second, which
-- could duplicate a person or leave an unlinked contact after a partial error.
CREATE OR REPLACE FUNCTION public.convert_institutional_lead(
  p_lead_id uuid,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_product text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  actor uuid := auth.uid();
  intake public.leads_institucional%ROWTYPE;
  clean_name text := nullif(btrim(p_name), '');
  clean_email text := nullif(lower(btrim(p_email)), '');
  raw_phone text := nullif(btrim(p_phone), '');
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  clean_company text := nullif(btrim(p_company), '');
  clean_product text := nullif(btrim(p_product), '');
  matches uuid[];
  target uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'lead id required'; END IF;
  IF length(coalesce(clean_name, '')) > 255 OR length(coalesce(clean_email, '')) > 320
    OR length(coalesce(raw_phone, '')) > 64 OR length(coalesce(clean_company, '')) > 255
    OR length(coalesce(clean_product, '')) > 255
  THEN RAISE EXCEPTION 'form fields too long'; END IF;

  -- Serialize conversions for this owner, including two distinct form rows
  -- that refer to the same person. Contact identity indexes remain the final
  -- guard against writes made by other ingestion paths.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  SELECT * INTO intake FROM public.leads_institucional
    WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form submission not found'; END IF;

  IF intake.status = 'convertido' THEN
    SELECT c.id INTO target FROM public.contacts c
    WHERE c.id = intake.contact_id AND c.user_id = actor;
    IF target IS NULL THEN RAISE EXCEPTION 'form already linked to another owner'; END IF;
    RETURN target;
  END IF;

  clean_name := coalesce(clean_name, nullif(btrim(intake.lead), ''));
  clean_email := coalesce(clean_email, nullif(lower(btrim(intake.email)), ''));
  raw_phone := coalesce(raw_phone, nullif(btrim(intake.whatsapp), ''));
  clean_phone := nullif(regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g'), '');
  IF clean_phone IS NULL THEN raw_phone := NULL; END IF;
  clean_product := coalesce(clean_product, nullif(btrim(intake.produto), ''));
  IF lower(clean_product) IN ('interesse geral', 'interesse geral nos serviços da ag labs', 'atendimento geral') THEN
    clean_product := NULL;
  ELSIF lower(clean_product) IN ('barberpro', 'barber pro') THEN
    clean_product := 'barberias';
  END IF;
  IF clean_name IS NULL AND clean_email IS NULL AND clean_phone IS NULL THEN
    RAISE EXCEPTION 'contact identity required';
  END IF;

  SELECT array_agg(DISTINCT c.id) INTO matches
  FROM public.contacts c
  WHERE c.user_id = actor AND (
    (clean_email IS NOT NULL AND lower(c.email) = clean_email)
    OR (clean_phone IS NOT NULL AND (
      regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = clean_phone
      OR regexp_replace(coalesce(c.whatsapp::text, ''), '[^0-9]', '', 'g') = clean_phone
    ))
  );
  IF coalesce(cardinality(matches), 0) > 1 THEN
    RAISE EXCEPTION 'identity conflict: email and phone belong to different contacts';
  END IF;
  target := matches[1];

  IF target IS NULL THEN
    INSERT INTO public.contacts (user_id, name, email, phone, company, produto, status, origin)
    VALUES (actor, clean_name, clean_email, raw_phone, clean_company, clean_product, 'Lead', 'web')
    RETURNING id INTO target;
  ELSE
    UPDATE public.contacts c SET
      name = coalesce(nullif(btrim(c.name), ''), clean_name),
      email = coalesce(c.email, clean_email),
      phone = coalesce(c.phone, raw_phone),
      company = coalesce(c.company, clean_company),
      produto = coalesce(clean_product, c.produto),
      status = CASE WHEN c.status = 'Arquivado' THEN 'Lead' ELSE c.status END,
      prospecting_pool = false
    WHERE c.id = target AND c.user_id = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact unavailable'; END IF;
  END IF;

  UPDATE public.leads_institucional SET
    status = 'convertido', contact_id = target, produto = clean_product
  WHERE id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form link failed'; END IF;

  INSERT INTO public.activities (user_id, contact_id, type, content)
  VALUES (actor, target, 'note', 'Formulário do site vinculado a esta ficha.');
  RETURN target;
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_institutional_lead(uuid,text,text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.convert_institutional_lead(uuid,text,text,text,text,text)
  TO authenticated;
