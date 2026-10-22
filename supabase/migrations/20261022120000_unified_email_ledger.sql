-- Problem: e-mails sent to a contact lived in three places with no final status.
-- Prospecting sends were free-text notes in `activities`; Brevo campaign events
-- matched only campaign recipients; Barberias system e-mails (Resend) never
-- reached the CRM, so trial accounts were not contacts at all. When someone
-- replied, Maia had no record of what we had sent.
--
-- One ledger row per message, independent of provider and source, with its
-- own event history. Writes happen only through service-role RPCs (webhooks,
-- agents, backfill); the browser reads under RLS. Nothing here sends e-mail.
--
-- Account lifecycle (trial/active/cancelled) is stored apart from the
-- commercial funnel: a trial e-mail never moves a client backwards.

CREATE SCHEMA IF NOT EXISTS crm_ledger_private;
REVOKE ALL ON SCHEMA crm_ledger_private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Contacts: account lifecycle + origin for product sign-ups
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS account_status text,
  ADD COLUMN IF NOT EXISTS account_ref text,
  ADD COLUMN IF NOT EXISTS account_updated_at timestamptz;
UPDATE public.contacts SET account_status = NULL
  WHERE account_status IS NOT NULL AND account_status NOT IN ('trial', 'trial_encerrado', 'ativo', 'cancelado');
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_account_status_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_account_status_check
  CHECK (account_status IS NULL OR account_status IN ('trial', 'trial_encerrado', 'ativo', 'cancelado'));
COMMENT ON COLUMN public.contacts.account_status IS
  'Product account lifecycle (trial/trial_encerrado/ativo/cancelado). Independent of the funnel status.';

-- Normalize before the constraint so the migration never fails on old values.
UPDATE public.contacts SET origin = 'manual'
  WHERE origin IS NOT NULL AND origin NOT IN ('web', 'prospeccao', 'whatsapp', 'email', 'manual', 'compra', 'instagram', 'cadastro');
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_origin_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_origin_check
  CHECK (origin IN ('web', 'prospeccao', 'whatsapp', 'email', 'manual', 'compra', 'instagram', 'cadastro'));

-- ---------------------------------------------------------------------------
-- 2. Ledger tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  provider text NOT NULL CHECK (provider IN ('brevo', 'resend', 'mailbox')),
  category text NOT NULL CHECK (category IN ('prospeccao', 'campanha', 'automacao', 'transacional', 'atendimento')),
  source_key text NOT NULL CHECK (source_key ~ '^[a-z0-9][a-z0-9._:-]{1,119}$'),
  product text CHECK (product IS NULL OR length(btrim(product)) BETWEEN 1 AND 120),
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES public.email_campaign_recipients(id) ON DELETE SET NULL,
  in_reply_to_message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  -- Counterpart address: the recipient of an outbound message, the sender of an inbound one.
  address text NOT NULL CHECK (address = lower(btrim(address)) AND length(address) BETWEEN 3 AND 320
    AND address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  from_address text CHECK (from_address IS NULL OR length(from_address) <= 320),
  reply_to text CHECK (reply_to IS NULL OR length(reply_to) <= 320),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 300),
  summary text CHECK (summary IS NULL OR length(summary) <= 800),
  body_text text CHECK (body_text IS NULL OR length(body_text) <= 20000),
  body_html text CHECK (body_html IS NULL OR length(body_html) <= 200000),
  provider_message_id text CHECK (provider_message_id IS NULL OR (length(provider_message_id) BETWEEN 1 AND 1000
    AND provider_message_id !~ '[[:cntrl:]]')),
  rfc_message_id text CHECK (rfc_message_id IS NULL OR (length(rfc_message_id) BETWEEN 5 AND 998
    AND rfc_message_id ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN (
    'scheduled', 'accepted', 'deferred', 'soft_bounced', 'delivered', 'opened', 'clicked', 'replied',
    'failed', 'bounced', 'complained', 'unsubscribed', 'received')),
  sent_at timestamptz NOT NULL,
  status_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (direction = 'inbound' OR provider_message_id IS NOT NULL OR provider = 'mailbox')
);
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_key
  ON public.email_messages(user_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_rfc_key
  ON public.email_messages(user_id, rfc_message_id) WHERE rfc_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_contact_idx ON public.email_messages(contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_address_idx ON public.email_messages(user_id, address, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_source_idx ON public.email_messages(user_id, source_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_recipient_idx ON public.email_messages(recipient_id) WHERE recipient_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'scheduled', 'accepted', 'deferred', 'soft_bounced', 'delivered', 'opened', 'proxy_open', 'clicked',
    'replied', 'failed', 'bounced', 'complained', 'unsubscribed')),
  provider_event_type text CHECK (provider_event_type IS NULL OR length(provider_event_type) <= 100),
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 300),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, event_key)
);
CREATE INDEX IF NOT EXISTS email_message_events_message_idx ON public.email_message_events(message_id, occurred_at);

-- Lifecycle events from product backends (Barberias), deduplicated by key.
CREATE TABLE IF NOT EXISTS crm_ledger_private.account_events (
  event_key text PRIMARY KEY CHECK (length(event_key) BETWEEN 1 AND 300),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_ledger_private.account_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read email messages" ON public.email_messages;
CREATE POLICY "owners read email messages" ON public.email_messages FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "owners read email message events" ON public.email_message_events;
CREATE POLICY "owners read email message events" ON public.email_message_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.email_messages m WHERE m.id = message_id
  AND (m.user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = (SELECT auth.uid())))));

REVOKE ALL ON public.email_messages, public.email_message_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_messages, public.email_message_events TO authenticated;
GRANT ALL ON public.email_messages, public.email_message_events TO service_role;
REVOKE ALL ON crm_ledger_private.account_events FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------
-- Same single-owner tenant used by the Maia intake functions.
CREATE OR REPLACE FUNCTION crm_ledger_private.tenant() RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '0af00833-c1f7-42f4-9543-a5e0ff6f55fc'::uuid $$;

-- This internal CRM has two legitimate writers: Maia and the dashboard admin.
-- Keep each contact's owner; do not duplicate or transfer the prospecting pool.
CREATE OR REPLACE FUNCTION crm_ledger_private.contact_owner(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT uid = crm_ledger_private.tenant() OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = uid)
$$;

-- Legacy intake may reuse an admin-owned contact ONLY after an outbound ledger
-- row has bound its canonical address. This does not admit unrelated tenants.
CREATE OR REPLACE FUNCTION crm_ledger_private.intake_contact(cid uuid, sender text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = cid AND lower(btrim(c.email)) = sender
    AND (c.user_id = crm_ledger_private.tenant() OR (crm_ledger_private.contact_owner(c.user_id)
      AND EXISTS (SELECT 1 FROM public.email_messages m WHERE m.user_id = crm_ledger_private.tenant()
        AND m.contact_id = c.id AND m.direction = 'outbound' AND m.address = sender))))
$$;

-- Status only moves forward. Negative terminal outcomes outrank engagement so
-- an unsubscribe after an open is never hidden. proxy_open never changes status.
CREATE OR REPLACE FUNCTION crm_ledger_private.status_rank(s text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE s WHEN 'scheduled' THEN 0 WHEN 'received' THEN 0 WHEN 'accepted' THEN 1 WHEN 'deferred' THEN 2
    WHEN 'soft_bounced' THEN 3 WHEN 'delivered' THEN 4 WHEN 'opened' THEN 5 WHEN 'clicked' THEN 6
    WHEN 'replied' THEN 7 WHEN 'failed' THEN 8 WHEN 'bounced' THEN 9 WHEN 'complained' THEN 10
    WHEN 'unsubscribed' THEN 11 ELSE -1 END
$$;

CREATE OR REPLACE FUNCTION crm_ledger_private.normalize_rfc(v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN v IS NULL OR btrim(v) = '' THEN NULL
    WHEN btrim(v) ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$' THEN btrim(v)
    WHEN btrim(v) ~ '^[^<>[:space:]]+@[^<>[:space:]]+$' THEN '<' || btrim(v) || '>'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION crm_ledger_private.valid_address(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT v IS NOT NULL AND v = lower(btrim(v)) AND length(v) BETWEEN 3 AND 320
    AND v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$$;

-- Summaries reach a language model: reject obvious secrets and card numbers.
CREATE OR REPLACE FUNCTION crm_ledger_private.safe_summary(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT v IS NULL OR (length(v) <= 800
    AND v !~* '\m(cvv|senha|password|token|chave privada)\M'
    AND regexp_replace(v, '[ -]', '', 'g') !~ '[0-9]{15,16}')
$$;

-- Bind a sender address to the contact whose primary e-mail it is, so that a
-- reply to something we sent attaches to that contact instead of becoming an
-- unresolved identity. Never steals an existing binding (same rule as
-- maia_resolve_email_pending) and never binds an address shared by contacts.
CREATE OR REPLACE FUNCTION crm_ledger_private.bind_email_identity(p_contact uuid, p_address text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant constant uuid := crm_ledger_private.tenant();
BEGIN
  IF to_regclass('maia_intake_private.identities') IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.contacts c WHERE crm_ledger_private.contact_owner(c.user_id) AND lower(btrim(c.email)) = p_address) <> 1 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact AND crm_ledger_private.contact_owner(c.user_id) AND lower(btrim(c.email)) = p_address) THEN RETURN; END IF;
  INSERT INTO maia_intake_private.identities(user_id, channel, subject, contact_id)
  VALUES (tenant, 'email', p_address, p_contact) ON CONFLICT DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION crm_ledger_private.apply_event(
  p_message uuid, p_type text, p_provider_type text, p_key text, p_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.email_messages; inserted uuid;
BEGIN
  IF p_type IS NULL OR crm_ledger_private.status_rank(p_type) < 0 AND p_type <> 'proxy_open' THEN RETURN false; END IF;
  SELECT * INTO m FROM public.email_messages WHERE id = p_message FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.email_message_events(message_id, event_type, provider_event_type, event_key, occurred_at)
  VALUES (p_message, p_type, p_provider_type, p_key, p_at)
  ON CONFLICT (message_id, event_key) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN RETURN false; END IF;
  UPDATE public.email_messages SET
    status = CASE WHEN crm_ledger_private.status_rank(p_type) > crm_ledger_private.status_rank(status) THEN p_type ELSE status END,
    status_at = CASE WHEN crm_ledger_private.status_rank(p_type) > crm_ledger_private.status_rank(status) THEN p_at ELSE status_at END,
    delivered_at = CASE WHEN p_type = 'delivered' THEN coalesce(least(delivered_at, p_at), p_at) ELSE delivered_at END,
    opened_at = CASE WHEN p_type IN ('opened', 'clicked') THEN coalesce(least(opened_at, p_at), p_at) ELSE opened_at END,
    clicked_at = CASE WHEN p_type = 'clicked' THEN coalesce(least(clicked_at, p_at), p_at) ELSE clicked_at END,
    replied_at = CASE WHEN p_type = 'replied' THEN coalesce(least(replied_at, p_at), p_at) ELSE replied_at END,
    bounced_at = CASE WHEN p_type IN ('bounced', 'soft_bounced', 'failed') THEN coalesce(least(bounced_at, p_at), p_at) ELSE bounced_at END
  WHERE id = p_message;
  -- Permanent failure, complaint or unsubscribe: never contact this address again.
  IF p_type IN ('bounced', 'complained', 'unsubscribed') THEN
    UPDATE public.contacts SET outreach_status = 'blocked'
      WHERE id = m.contact_id AND lower(btrim(email)) = m.address AND outreach_status IS DISTINCT FROM 'blocked';
  END IF;
  -- Replies come from the support mailbox, not from the provider webhook.
  IF p_type = 'replied' AND m.recipient_id IS NOT NULL THEN
    INSERT INTO public.email_campaign_events(recipient_id, event_type, provider_event_type, provider_event_id, occurred_at)
    VALUES (m.recipient_id, 'replied', 'mailbox_reply', 'reply:' || p_key, p_at)
    ON CONFLICT (recipient_id, provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION crm_ledger_private.account_rank(s text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE s WHEN 'trial' THEN 1 WHEN 'trial_encerrado' THEN 2 WHEN 'ativo' THEN 3 WHEN 'cancelado' THEN 3 ELSE 0 END
$$;

-- Resolve or create the contact for an address. Prefers the Maia identity
-- binding, then the single contact with that e-mail, then the oldest one.
CREATE OR REPLACE FUNCTION crm_ledger_private.resolve_contact(p_address text, p_contact_id uuid, p_spec jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant constant uuid := crm_ledger_private.tenant(); cid uuid; spec jsonb := coalesce(p_spec, '{}'::jsonb);
  c public.contacts; new_account text; promote text;
BEGIN
  IF p_contact_id IS NOT NULL THEN
    SELECT id INTO cid FROM public.contacts WHERE id = p_contact_id AND crm_ledger_private.contact_owner(user_id) AND lower(btrim(email)) = p_address;
    IF cid IS NULL THEN RAISE EXCEPTION 'contact/address mismatch'; END IF;
  ELSE
    IF to_regclass('maia_intake_private.identities') IS NOT NULL THEN
      EXECUTE 'SELECT i.contact_id FROM maia_intake_private.identities i JOIN public.contacts c ON c.id = i.contact_id
        WHERE i.user_id = $1 AND i.channel = ''email'' AND i.subject = $2 AND crm_ledger_private.contact_owner(c.user_id) AND lower(btrim(c.email)) = $2'
        INTO cid USING tenant, p_address;
    END IF;
    IF cid IS NULL THEN
      SELECT id INTO cid FROM public.contacts WHERE crm_ledger_private.contact_owner(user_id) AND lower(btrim(email)) = p_address
        ORDER BY created_at ASC, id ASC LIMIT 1;
    END IF;
  END IF;

  IF cid IS NULL THEN
    IF spec = '{}'::jsonb THEN RAISE EXCEPTION 'contact required'; END IF;
    INSERT INTO public.contacts(user_id, name, company, email, status, origin, produto, prospecting_pool,
      account_status, account_ref, account_updated_at, notes)
    VALUES (tenant, nullif(left(btrim(spec->>'name'), 200), ''), nullif(left(btrim(spec->>'company'), 200), ''),
      p_address, coalesce(nullif(spec->>'status', ''), 'Contato'), nullif(spec->>'origin', ''),
      nullif(spec->>'product', ''), false, nullif(spec->>'account_status', ''), nullif(left(spec->>'account_ref', 200), ''),
      CASE WHEN nullif(spec->>'account_status', '') IS NOT NULL THEN now() END,
      nullif(left(spec->>'notes', 2000), ''))
    RETURNING id INTO cid;
    RETURN cid;
  END IF;

  -- Existing contact: fill gaps, advance the account lifecycle, never regress the funnel.
  SELECT * INTO c FROM public.contacts WHERE id = cid FOR UPDATE;
  new_account := nullif(spec->>'account_status', '');
  promote := nullif(spec->>'promote_status', '');
  UPDATE public.contacts SET
    name = coalesce(name, nullif(left(btrim(spec->>'name'), 200), '')),
    company = coalesce(company, nullif(left(btrim(spec->>'company'), 200), '')),
    produto = coalesce(produto, nullif(spec->>'product', '')),
    account_ref = coalesce(account_ref, nullif(left(spec->>'account_ref', 200), '')),
    account_status = CASE WHEN new_account IS NOT NULL
      AND (spec->>'account_authoritative' = 'true' OR crm_ledger_private.account_rank(new_account) > crm_ledger_private.account_rank(account_status))
      THEN new_account ELSE account_status END,
    account_updated_at = CASE WHEN new_account IS NOT NULL AND new_account IS DISTINCT FROM account_status
      AND (spec->>'account_authoritative' = 'true' OR crm_ledger_private.account_rank(new_account) > crm_ledger_private.account_rank(account_status))
      THEN now() ELSE account_updated_at END
  WHERE id = cid;
  -- A sign-up is engagement: move cold or unqualified contacts to Lead only.
  IF promote = 'Lead' AND (c.status = 'Contato' OR (c.status = 'Arquivado' AND c.prospecting_pool)) THEN
    UPDATE public.contacts SET status = 'Lead' WHERE id = cid;
  ELSIF promote = 'Cliente' AND c.status NOT IN ('Cliente') THEN
    UPDATE public.contacts SET status = 'Cliente' WHERE id = cid;
  ELSIF promote = 'Inativo' AND c.status = 'Cliente' THEN
    UPDATE public.contacts SET status = 'Inativo' WHERE id = cid;
  END IF;
  RETURN cid;
END
$$;

CREATE OR REPLACE FUNCTION crm_ledger_private.record_outbound(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant constant uuid := crm_ledger_private.tenant(); existing public.email_messages;
  addr text := lower(btrim(p->>'address')); pmid text := nullif(btrim(p->>'provider_message_id'), '');
  rfc text := crm_ledger_private.normalize_rfc(p->>'rfc_message_id'); cid uuid; mid uuid;
  initial text := coalesce(nullif(p->>'status', ''), 'accepted'); sent timestamptz := (p->>'sent_at')::timestamptz;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT crm_ledger_private.valid_address(addr)
    OR coalesce(p->>'provider', '') NOT IN ('brevo', 'resend') OR pmid IS NULL
    OR coalesce(p->>'category', '') NOT IN ('prospeccao', 'campanha', 'automacao', 'transacional', 'atendimento')
    OR coalesce(btrim(p->>'subject'), '') = '' OR sent IS NULL OR sent > now() + interval '30 days'
    OR initial NOT IN ('scheduled', 'accepted') OR NOT crm_ledger_private.safe_summary(p->>'summary')
  THEN RAISE EXCEPTION 'invalid outbound message'; END IF;
  IF p->>'rfc_message_id' IS NOT NULL AND rfc IS NULL THEN RAISE EXCEPTION 'invalid rfc message id'; END IF;
  -- Brevo's messageId is the RFC Message-ID header itself (verified against a
  -- delivered message), so replies can be matched by In-Reply-To.
  IF p->>'provider' = 'brevo' THEN
    pmid := btrim(pmid, '<> ');
    rfc := coalesce(rfc, crm_ledger_private.normalize_rfc(pmid));
  ELSE
    pmid := lower(pmid);
  END IF;

  SELECT * INTO existing FROM public.email_messages
    WHERE user_id = tenant AND provider = p->>'provider' AND provider_message_id = pmid FOR UPDATE;
  IF FOUND THEN
    IF existing.address <> addr THEN RAISE EXCEPTION 'message/address conflict'; END IF;
    -- Idempotent replay: only fill what was unknown.
    UPDATE public.email_messages SET
      rfc_message_id = coalesce(rfc_message_id, rfc),
      summary = coalesce(summary, nullif(p->>'summary', '')),
      body_text = coalesce(body_text, nullif(p->>'body_text', '')),
      body_html = coalesce(body_html, nullif(p->>'body_html', '')),
      campaign_id = coalesce(campaign_id, nullif(p->>'campaign_id', '')::uuid),
      recipient_id = coalesce(recipient_id, nullif(p->>'recipient_id', '')::uuid)
    WHERE id = existing.id;
    IF EXISTS (SELECT 1 FROM public.contacts WHERE id = existing.contact_id AND lower(btrim(email)) = addr) THEN
      PERFORM crm_ledger_private.resolve_contact(addr, existing.contact_id, p->'contact');
    END IF;
    RETURN existing.id;
  END IF;

  cid := crm_ledger_private.resolve_contact(addr, nullif(p->>'contact_id', '')::uuid, p->'contact');
  INSERT INTO public.email_messages(user_id, contact_id, direction, provider, category, source_key, product,
    campaign_id, recipient_id, address, from_address, reply_to, subject, summary, body_text, body_html,
    provider_message_id, rfc_message_id, status, sent_at, status_at)
  VALUES (tenant, cid, 'outbound', p->>'provider', p->>'category', p->>'source_key', nullif(p->>'product', ''),
    nullif(p->>'campaign_id', '')::uuid, nullif(p->>'recipient_id', '')::uuid, addr,
    nullif(left(p->>'from_address', 320), ''), nullif(left(p->>'reply_to', 320), ''), left(btrim(p->>'subject'), 300),
    nullif(p->>'summary', ''), nullif(p->>'body_text', ''), nullif(p->>'body_html', ''),
    pmid, rfc, initial, sent, sent)
  RETURNING id INTO mid;
  PERFORM crm_ledger_private.bind_email_identity(cid, addr);
  RETURN mid;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Service RPCs (webhooks, agents, backfill)
-- ---------------------------------------------------------------------------
-- Record one outbound message (Brevo prospecting, campaigns, Resend system e-mail).
CREATE OR REPLACE FUNCTION public.crm_record_outbound_email(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mid uuid; m public.email_messages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('email-ledger:' || lower(btrim(coalesce(p->>'address', ''))), 0));
  mid := crm_ledger_private.record_outbound(p);
  SELECT * INTO m FROM public.email_messages WHERE id = mid;
  RETURN jsonb_build_object('ok', true, 'message_id', m.id, 'contact_id', m.contact_id, 'status', m.status);
END
$$;

-- Apply a provider event to a ledger message identified by provider + id.
CREATE OR REPLACE FUNCTION public.crm_apply_email_event(
  p_provider text, p_provider_message_id text, p_event_type text, p_provider_event_type text,
  p_event_key text, p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mid uuid; applied boolean := false;
BEGIN
  IF p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes' OR coalesce(p_event_key, '') = '' THEN
    RAISE EXCEPTION 'invalid event'; END IF;
  SELECT id INTO mid FROM public.email_messages WHERE user_id = crm_ledger_private.tenant()
    AND provider = p_provider AND provider_message_id = CASE WHEN p_provider = 'brevo'
      THEN btrim(p_provider_message_id, '<> ') ELSE lower(btrim(p_provider_message_id)) END;
  IF mid IS NOT NULL THEN applied := crm_ledger_private.apply_event(mid, p_event_type, p_provider_event_type, p_event_key, p_occurred_at); END IF;
  RETURN jsonb_build_object('ok', true, 'matched', mid IS NOT NULL, 'applied', applied);
END
$$;

-- Resend webhook / backfill. Classification is decided by the caller; an
-- unknown message without classification (e.g. a barbershop customer's
-- appointment e-mail) is ignored and nothing is stored.
CREATE OR REPLACE FUNCTION public.crm_ingest_resend_event(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mid uuid; addr text := lower(btrim(p->>'address')); applied boolean; at timestamptz := (p->>'occurred_at')::timestamptz;
BEGIN
  IF coalesce(p->>'email_id', '') !~ '^[0-9a-fA-F-]{36}$' OR at IS NULL OR at > now() + interval '5 minutes'
    OR coalesce(p->>'event_key', '') = '' THEN RAISE EXCEPTION 'invalid resend event'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email-ledger:' || coalesce(addr, ''), 0));
  SELECT id INTO mid FROM public.email_messages WHERE user_id = crm_ledger_private.tenant()
    AND provider = 'resend' AND provider_message_id = lower(p->>'email_id');
  IF mid IS NULL THEN
    IF jsonb_typeof(p->'record') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok', true, 'status', 'ignored'); END IF;
    mid := crm_ledger_private.record_outbound((p->'record') || jsonb_build_object(
      'provider', 'resend', 'provider_message_id', lower(p->>'email_id'), 'address', addr));
  ELSIF jsonb_typeof(p->'record') = 'object' AND p->'record' ? 'rfc_message_id' THEN
    UPDATE public.email_messages SET rfc_message_id = coalesce(rfc_message_id, crm_ledger_private.normalize_rfc(p->'record'->>'rfc_message_id'))
      WHERE id = mid;
  END IF;
  applied := crm_ledger_private.apply_event(mid, p->>'event_type', p->>'provider_event_type', 'resend:' || (p->>'event_key'), at);
  RETURN jsonb_build_object('ok', true, 'status', 'recorded', 'message_id', mid, 'applied', applied);
END
$$;

-- Brevo events without address or message id (anonymized opens/clicks) can
-- only be attributed by an exact, unique subject sent recently by the same
-- account. Prospecting subjects are personalized, so this is unambiguous;
-- anything else is ignored.
CREATE OR REPLACE FUNCTION public.crm_apply_brevo_anonymized_events(p_connection_id uuid, p_events jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE connection public.email_provider_connections; item jsonb; at timestamptz; kind text; mids uuid[]; m public.email_messages; matched integer := 0;
BEGIN
  SELECT * INTO STRICT connection FROM public.email_provider_connections WHERE id = p_connection_id;
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events) > 100 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    at := (item->>'occurred_at')::timestamptz; kind := item->>'event_type';
    IF at IS NULL OR at > now() + interval '5 minutes' OR kind NOT IN ('opened', 'clicked', 'proxy_open')
      OR coalesce(item->>'subject', '') = '' OR coalesce(item->>'event_key', '') = '' THEN CONTINUE; END IF;
    SELECT array_agg(id) INTO mids FROM public.email_messages
      WHERE user_id = crm_ledger_private.tenant() AND crm_ledger_private.contact_owner(connection.user_id) AND provider = 'brevo' AND direction = 'outbound'
        AND subject = btrim(item->>'subject') AND sent_at BETWEEN at - interval '60 days' AND at + interval '5 minutes';
    IF coalesce(array_length(mids, 1), 0) <> 1 THEN CONTINUE; END IF;
    IF crm_ledger_private.apply_event(mids[1], kind, item->>'provider_type', 'brevo-anon:' || (item->>'event_key'), at) THEN
      matched := matched + 1;
      SELECT * INTO m FROM public.email_messages WHERE id = mids[1];
      IF m.recipient_id IS NOT NULL THEN
        INSERT INTO public.email_campaign_events(recipient_id, event_type, provider_event_type, provider_event_id, occurred_at)
        VALUES (m.recipient_id, kind, item->>'provider_type', 'brevo-anon:' || (item->>'event_key'), at)
        ON CONFLICT (recipient_id, provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;
      END IF;
    END IF;
  END LOOP;
  RETURN matched;
END
$$;

-- Product lifecycle (sign-up, trial end, subscription) from a product backend.
CREATE OR REPLACE FUNCTION public.crm_ingest_account_event(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE addr text := lower(btrim(p->>'owner_email')); at timestamptz := (p->>'occurred_at')::timestamptz;
  ev text := p->>'event'; cid uuid; account text; promote text; label text; product text := coalesce(nullif(p->>'product', ''), 'barberias');
BEGIN
  IF NOT crm_ledger_private.valid_address(addr) OR at IS NULL OR at > now() + interval '5 minutes'
    OR coalesce(p->>'event_key', '') = '' OR length(p->>'event_key') > 300 THEN RAISE EXCEPTION 'invalid account event'; END IF;
  account := CASE ev WHEN 'account.created' THEN 'trial' WHEN 'trial.started' THEN 'trial'
    WHEN 'trial.ended' THEN 'trial_encerrado' WHEN 'subscription.active' THEN 'ativo'
    WHEN 'subscription.canceled' THEN 'cancelado' ELSE NULL END;
  promote := CASE ev WHEN 'account.created' THEN 'Lead' WHEN 'trial.started' THEN 'Lead'
    WHEN 'subscription.active' THEN 'Cliente' WHEN 'subscription.canceled' THEN 'Inativo' ELSE NULL END;
  label := CASE ev WHEN 'account.created' THEN 'conta criada, teste grátis iniciado'
    WHEN 'trial.started' THEN 'teste grátis iniciado' WHEN 'onboarding.completed' THEN 'configuração inicial concluída'
    WHEN 'first_appointment' THEN 'primeiro agendamento recebido' WHEN 'trial.ended' THEN 'teste grátis encerrado'
    WHEN 'subscription.active' THEN 'assinatura ativa' WHEN 'subscription.canceled' THEN 'assinatura cancelada' ELSE NULL END;
  IF label IS NULL THEN RAISE EXCEPTION 'unknown account event'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email-ledger:' || addr, 0));
  IF EXISTS (SELECT 1 FROM crm_ledger_private.account_events WHERE event_key = p->>'event_key') THEN
    RETURN jsonb_build_object('ok', true, 'status', 'duplicate');
  END IF;
  cid := crm_ledger_private.resolve_contact(addr, NULL, jsonb_build_object(
    'name', coalesce(nullif(p->>'owner_name', ''), p->>'account_name'), 'company', p->>'account_name',
    'status', CASE promote WHEN 'Cliente' THEN 'Cliente' WHEN 'Inativo' THEN 'Inativo' ELSE 'Lead' END, 'origin', 'cadastro', 'product', product, 'account_status', account,
    'account_ref', p->>'account_ref', 'account_authoritative', 'true', 'promote_status', promote));
  INSERT INTO crm_ledger_private.account_events(event_key, contact_id, event, occurred_at) VALUES (p->>'event_key', cid, ev, at);
  INSERT INTO public.activities(user_id, contact_id, type, channel, content)
  VALUES (crm_ledger_private.tenant(), cid, 'note', 'sistema',
    initcap(product) || ': ' || label || coalesce(' — ' || nullif(left(p->>'account_name', 120), ''), '') || '.');
  PERFORM crm_ledger_private.bind_email_identity(cid, addr);
  RETURN jsonb_build_object('ok', true, 'status', 'recorded', 'contact_id', cid);
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Maia: context before answering, and reply registration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_ledger_private.normalize_refs(p_refs text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL), ARRAY[]::text[])
  FROM (SELECT crm_ledger_private.normalize_rfc(x) AS r FROM unnest((coalesce(p_refs, ARRAY[]::text[]))[1:20]) x) s
$$;

-- What we sent to this sender and who they are. Matches the reply thread by
-- In-Reply-To/References first; otherwise the sender's own address. Only
-- summaries and statuses are returned: no bodies, ids or other contacts.
CREATE OR REPLACE FUNCTION public.maia_email_context(p_sender text, p_reference_ids text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant constant uuid := crm_ledger_private.tenant(); sender text := lower(btrim(p_sender));
  refs text[] := crm_ledger_private.normalize_refs(p_reference_ids); thread public.email_messages; cid uuid;
  c public.contacts; recent jsonb; task jsonb;
BEGIN
  IF NOT crm_ledger_private.valid_address(sender) THEN RETURN jsonb_build_object('version', 1, 'status', 'invalid'); END IF;
  SELECT * INTO thread FROM public.email_messages
    WHERE user_id = tenant AND direction = 'outbound' AND address = sender AND rfc_message_id = ANY(refs)
    ORDER BY sent_at DESC LIMIT 1;
  cid := thread.contact_id;
  IF cid IS NULL AND to_regclass('maia_intake_private.identities') IS NOT NULL THEN
    EXECUTE 'SELECT i.contact_id FROM maia_intake_private.identities i JOIN public.contacts c ON c.id = i.contact_id
      WHERE i.user_id = $1 AND i.channel = ''email'' AND i.subject = $2 AND crm_ledger_private.contact_owner(c.user_id) AND lower(btrim(c.email)) = $2' INTO cid USING tenant, sender;
  END IF;
  IF cid IS NULL THEN
    SELECT id INTO cid FROM public.contacts WHERE crm_ledger_private.contact_owner(user_id) AND lower(btrim(email)) = sender ORDER BY created_at, id LIMIT 1;
  END IF;
  IF cid IS NULL THEN RETURN jsonb_build_object('version', 1, 'status', 'unknown'); END IF;
  SELECT * INTO c FROM public.contacts WHERE id = cid;

  SELECT coalesce(jsonb_agg(x ORDER BY ts DESC), '[]'::jsonb) INTO recent FROM (
    SELECT jsonb_build_object('direction', m.direction, 'category', m.category, 'source', m.source_key, 'product', m.product,
      'subject', m.subject, 'summary', m.summary, 'sent_at', m.sent_at, 'status', m.status) AS x, m.sent_at AS ts
    FROM public.email_messages m
    WHERE m.user_id = tenant AND m.contact_id = cid AND m.sent_at > now() - interval '180 days'
    ORDER BY m.sent_at DESC LIMIT 6) s;
  SELECT jsonb_build_object('title', t.title, 'due_date', t.due_date, 'assigned_to', t.assigned_to) INTO task
    FROM public.tasks t WHERE t.contact_id = cid AND t.status = 'pending' ORDER BY t.due_date NULLS LAST, t.created_at LIMIT 1;

  RETURN jsonb_build_object('version', 1, 'status', 'found',
    'match', CASE WHEN thread.id IS NOT NULL THEN 'thread' ELSE 'address' END,
    'replying_to', CASE WHEN thread.id IS NULL THEN NULL ELSE jsonb_build_object('category', thread.category,
      'source', thread.source_key, 'product', thread.product, 'subject', thread.subject, 'summary', thread.summary,
      'sent_at', thread.sent_at, 'status', thread.status) END,
    'contact', jsonb_build_object('name', c.name, 'company', c.company, 'product', c.produto, 'stage', c.status,
      'account_status', c.account_status, 'prospecting', c.prospecting_pool, 'do_not_contact', c.outreach_status = 'blocked'),
    'recent', recent, 'next_task', task);
END
$$;

-- Register a reply received by Maia: inbound ledger row + 'replied' on the
-- original message (and its campaign). Thread headers first; otherwise the
-- latest outbound to the same address in the last 30 days.
CREATE OR REPLACE FUNCTION public.maia_email_reply_record(
  p_sender text, p_reference_ids text[], p_rfc_message_id text, p_subject text, p_summary text, p_received_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant constant uuid := crm_ledger_private.tenant(); sender text := lower(btrim(p_sender));
  refs text[] := crm_ledger_private.normalize_refs(p_reference_ids); rfc text := crm_ledger_private.normalize_rfc(p_rfc_message_id);
  original public.email_messages; how text := 'thread'; inbound uuid; at timestamptz := coalesce(p_received_at, now());
BEGIN
  IF NOT crm_ledger_private.valid_address(sender) OR rfc IS NULL OR coalesce(btrim(p_subject), '') = ''
    OR coalesce(btrim(p_summary), '') = '' OR NOT crm_ledger_private.safe_summary(p_summary) OR at > now() + interval '5 minutes'
  THEN RAISE EXCEPTION 'invalid reply'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email-ledger:' || sender, 0));
  IF EXISTS (SELECT 1 FROM public.email_messages WHERE user_id = tenant AND rfc_message_id = rfc) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'duplicate');
  END IF;
  SELECT * INTO original FROM public.email_messages
    WHERE user_id = tenant AND direction = 'outbound' AND address = sender AND rfc_message_id = ANY(refs)
    ORDER BY sent_at DESC LIMIT 1;
  IF original.id IS NULL THEN
    how := 'recent';
    SELECT * INTO original FROM public.email_messages
      WHERE user_id = tenant AND direction = 'outbound' AND address = sender AND sent_at BETWEEN at - interval '30 days' AND at
      ORDER BY sent_at DESC LIMIT 1;
  END IF;
  IF original.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'status', 'unmatched'); END IF;
  INSERT INTO public.email_messages(user_id, contact_id, direction, provider, category, source_key, product, campaign_id,
    recipient_id, in_reply_to_message_id, address, subject, summary, rfc_message_id, status, sent_at, status_at)
  VALUES (tenant, original.contact_id, 'inbound', 'mailbox', 'atendimento', 'maia.reply', original.product, original.campaign_id,
    NULL, original.id, sender, left(btrim(p_subject), 300), btrim(p_summary), rfc, 'received', at, at)
  RETURNING id INTO inbound;
  PERFORM crm_ledger_private.apply_event(original.id, 'replied', 'mailbox_reply',
    'reply:' || encode(sha256(convert_to(rfc, 'UTF8')), 'hex'), at);
  RETURN jsonb_build_object('ok', true, 'status', 'recorded', 'match', how);
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Brevo webhook mirror: every inbox event also updates the ledger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_ledger_private.mirror_brevo_inbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE kind text; target uuid;
BEGIN
  IF NEW.event_type IS NULL THEN RETURN NEW; END IF;
  kind := CASE
    WHEN NEW.provider_type = 'soft_bounce' THEN 'soft_bounced'
    WHEN NEW.provider_type IN ('hard_bounce', 'invalid_email') THEN 'bounced'
    WHEN NEW.event_type = 'sent' THEN 'accepted'
    WHEN NEW.event_type IN ('blocked', 'error') THEN 'failed'
    ELSE NEW.event_type END;
  FOR target IN SELECT m.id FROM public.email_messages m JOIN public.email_provider_connections c ON c.id = NEW.connection_id
    WHERE m.user_id = crm_ledger_private.tenant() AND crm_ledger_private.contact_owner(c.user_id) AND m.provider = 'brevo' AND btrim(m.provider_message_id, '<> ') = NEW.message_id
      AND public.brevo_address_key(NEW.connection_id, m.address) = NEW.address_key LOOP
    PERFORM crm_ledger_private.apply_event(target, kind, NEW.provider_type, 'brevo:' || NEW.event_key, NEW.occurred_at);
  END LOOP;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS mirror_brevo_inbox_to_ledger ON public.email_provider_event_inbox;
CREATE TRIGGER mirror_brevo_inbox_to_ledger AFTER INSERT ON public.email_provider_event_inbox
FOR EACH ROW EXECUTE FUNCTION crm_ledger_private.mirror_brevo_inbox();

-- ---------------------------------------------------------------------------
-- 7. Automation overview (RLS of the base table applies)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.email_source_summary WITH (security_invoker = true) AS
SELECT user_id, category, source_key, product,
  count(*) AS sent,
  count(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'opened', 'clicked', 'replied')) AS delivered,
  count(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
  count(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
  count(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
  count(*) FILTER (WHERE status IN ('bounced', 'soft_bounced', 'failed')) AS failed,
  count(*) FILTER (WHERE status IN ('complained', 'unsubscribed')) AS opted_out,
  max(sent_at) AS last_sent_at
FROM public.email_messages WHERE direction = 'outbound'
GROUP BY user_id, category, source_key, product;
REVOKE ALL ON public.email_source_summary FROM PUBLIC, anon;
GRANT SELECT ON public.email_source_summary TO authenticated, service_role;

-- Preserve legacy intake validation/idempotency, including immutable pending
-- events. Only broaden the canonical contact recheck to the approved ledger bridge.
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
      AND crm_ledger_private.intake_contact(c.id, p_subject)
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
    AND crm_ledger_private.intake_contact(id, p_subject)
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

-- ---------------------------------------------------------------------------
-- 8. Grants: service role only for writes and Maia; private helpers closed
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.maia_contact_intake(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maia_contact_intake(text,text,text,text) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_ledger_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_record_outbound_email(jsonb), public.crm_apply_email_event(text, text, text, text, text, timestamptz),
  public.crm_ingest_resend_event(jsonb), public.crm_apply_brevo_anonymized_events(uuid, jsonb), public.crm_ingest_account_event(jsonb),
  public.maia_email_context(text, text[]), public.maia_email_reply_record(text, text[], text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_outbound_email(jsonb), public.crm_apply_email_event(text, text, text, text, text, timestamptz),
  public.crm_ingest_resend_event(jsonb), public.crm_apply_brevo_anonymized_events(uuid, jsonb), public.crm_ingest_account_event(jsonb),
  public.maia_email_context(text, text[]), public.maia_email_reply_record(text, text[], text, text, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
