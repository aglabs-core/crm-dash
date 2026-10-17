-- Drafts lacked message content and audience preparation required one contact at
-- a time. Persist plain text and add reviewed recipients atomically, preserving
-- the current funnel, existing memberships and provider history. This sends nothing.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS content_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reply_to text;
UPDATE public.email_campaigns SET content_text = left(coalesce(content_text, ''), 12000),
  reply_to = CASE WHEN length(btrim(reply_to)) <= 320 AND btrim(reply_to) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    THEN lower(btrim(reply_to)) ELSE NULL END;
ALTER TABLE public.email_campaigns ALTER COLUMN content_text SET NOT NULL;
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaign_content_length;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaign_content_length CHECK (length(content_text) <= 12000);
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaign_reply_to_valid;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaign_reply_to_valid CHECK (
  reply_to IS NULL OR (length(reply_to) <= 320 AND reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE INDEX IF NOT EXISTS email_campaign_recipients_owner_email_idx
  ON public.email_campaign_recipients(user_id, lower(btrim(email_snapshot)));

-- Compare known aliases without changing the stored keys used by integrations.
CREATE OR REPLACE FUNCTION public.campaign_product_key(product text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE lower(btrim(coalesce(product, ''))) WHEN 'barberpro' THEN 'barberias'
    ELSE lower(btrim(coalesce(product, ''))) END
$$;
REVOKE ALL ON FUNCTION public.campaign_product_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_product_key(text) TO authenticated, service_role;

-- Keep this invoker query outside the policy expression so Postgres does not
-- recursively expand recipient/event policies while planning an INSERT.
CREATE OR REPLACE FUNCTION public.campaign_email_is_suppressed(address text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.email_campaign_events event
    JOIN public.email_campaign_recipients previous ON previous.id = event.recipient_id
    WHERE previous.user_id = auth.uid() AND lower(btrim(previous.email_snapshot)) = lower(btrim(address))
      AND event.event_type IN ('unsubscribed', 'complained'));
END
$$;
REVOKE ALL ON FUNCTION public.campaign_email_is_suppressed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_email_is_suppressed(text) TO authenticated;

DROP POLICY IF EXISTS "owners add reviewed recipients to drafts" ON public.email_campaign_recipients;
CREATE POLICY "owners add reviewed recipients to drafts" ON public.email_campaign_recipients FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.email_campaigns campaign JOIN public.contacts contact
    ON contact.id = email_campaign_recipients.contact_id
    WHERE campaign.id = email_campaign_recipients.campaign_id AND campaign.user_id = auth.uid() AND campaign.status = 'draft'
      AND contact.user_id = auth.uid() AND contact.outreach_status = 'contactable'
      AND lower(btrim(contact.email)) = lower(btrim(email_campaign_recipients.email_snapshot))
      AND contact.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND public.campaign_product_key(contact.produto) = public.campaign_product_key(campaign.product))
  AND NOT public.campaign_email_is_suppressed(email_campaign_recipients.email_snapshot)
);

CREATE OR REPLACE FUNCTION public.prepare_email_campaign(
  p_campaign_id uuid, p_subject text, p_content_text text, p_reply_to text,
  p_contact_ids uuid[], p_review_note text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE campaign public.email_campaigns; ids uuid[]; valid_count integer; added integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO campaign FROM public.email_campaigns
    WHERE id = p_campaign_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR campaign.status <> 'draft' THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_events event
    JOIN public.email_campaign_recipients recipient ON recipient.id = event.recipient_id
    WHERE recipient.campaign_id = campaign.id) THEN RAISE EXCEPTION 'Campaign has provider history'; END IF;
  IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 255
    OR p_content_text IS NULL OR length(p_content_text) > 12000
    OR (nullif(btrim(p_reply_to), '') IS NOT NULL AND
      (length(p_reply_to) > 320 OR p_reply_to !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    THEN RAISE EXCEPTION 'Invalid message'; END IF;
  IF coalesce(cardinality(p_contact_ids), 0) > 200 OR array_position(p_contact_ids, NULL) IS NOT NULL
    THEN RAISE EXCEPTION 'Select at most 200 reviewed contacts'; END IF;
  SELECT coalesce(array_agg(DISTINCT id), ARRAY[]::uuid[]) INTO ids FROM unnest(p_contact_ids) AS id;
  IF cardinality(ids) > 0 AND (p_review_note IS NULL OR length(btrim(p_review_note)) NOT BETWEEN 8 AND 1000)
    THEN RAISE EXCEPTION 'Review evidence required'; END IF;
  -- Keep identity/review stable until the audience insert completes.
  PERFORM id FROM public.contacts WHERE id = ANY(ids) AND user_id = auth.uid() FOR SHARE;
  SELECT count(*) INTO valid_count FROM public.contacts contact
    WHERE contact.id = ANY(ids) AND contact.user_id = auth.uid() AND contact.outreach_status = 'contactable'
      AND public.campaign_product_key(contact.produto) = public.campaign_product_key(campaign.product)
      AND contact.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  IF valid_count <> cardinality(ids) THEN RAISE EXCEPTION 'Audience changed; review contacts again'; END IF;
  UPDATE public.email_campaigns SET subject = btrim(p_subject), content_text = p_content_text,
    reply_to = lower(nullif(btrim(p_reply_to), '')), updated_at = now() WHERE id = campaign.id;
  INSERT INTO public.email_campaign_recipients(campaign_id, user_id, contact_id, email_snapshot, review_note)
    SELECT campaign.id, auth.uid(), contact.id, lower(btrim(contact.email)), btrim(p_review_note)
    FROM public.contacts contact WHERE contact.id = ANY(ids)
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  RETURN added;
END
$$;
REVOKE ALL ON FUNCTION public.prepare_email_campaign(uuid, text, text, text, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_email_campaign(uuid, text, text, text, uuid[], text) TO authenticated;
