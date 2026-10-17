-- Campaigns and provider events belong to a separate outbound ledger. A contact's
-- funnel stage never changes merely because a marketing message was sent.
-- No sending credentials or send RPCs are exposed to the browser.
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  product text NOT NULL CHECK (length(btrim(product)) BETWEEN 1 AND 120),
  provider text NOT NULL CHECK (provider IN ('brevo', 'resend')),
  sender_email text NOT NULL CHECK (length(btrim(sender_email)) BETWEEN 3 AND 320),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 255),
  audience_basis text NOT NULL CHECK (
    audience_basis IN ('opt_in', 'individual_review')
    AND (provider <> 'resend' OR audience_basis = 'opt_in')
  ),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'paused')),
  provider_campaign_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  user_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  email_snapshot text NOT NULL CHECK (length(btrim(email_snapshot)) BETWEEN 3 AND 320),
  review_note text NOT NULL CHECK (length(btrim(review_note)) BETWEEN 8 AND 1000),
  provider_message_id text,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_campaign_recipients_campaign_owner_fk
    FOREIGN KEY (campaign_id, user_id) REFERENCES public.email_campaigns(id, user_id) ON DELETE CASCADE,
  CONSTRAINT email_campaign_recipients_contact_fk
    FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  UNIQUE (campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS public.email_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.email_campaign_recipients(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'complained', 'unsubscribed'
  )),
  provider_event_id text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_events_provider_event_key
  ON public.email_campaign_events(recipient_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_campaigns_user_created_idx
  ON public.email_campaigns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_campaign_idx
  ON public.email_campaign_recipients(campaign_id, added_at DESC);
CREATE INDEX IF NOT EXISTS email_campaign_events_recipient_idx
  ON public.email_campaign_events(recipient_id, occurred_at DESC);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read email campaigns" ON public.email_campaigns;
CREATE POLICY "owners read email campaigns" ON public.email_campaigns FOR SELECT TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "owners create draft email campaigns" ON public.email_campaigns;
CREATE POLICY "owners create draft email campaigns" ON public.email_campaigns FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND status = 'draft');
DROP POLICY IF EXISTS "owners edit draft email campaigns" ON public.email_campaigns;
CREATE POLICY "owners edit draft email campaigns" ON public.email_campaigns FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND status = 'draft')
WITH CHECK (user_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "owners read email recipients" ON public.email_campaign_recipients;
CREATE POLICY "owners read email recipients" ON public.email_campaign_recipients FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.email_campaigns c WHERE c.id = campaign_id
  AND (c.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()))
));
DROP POLICY IF EXISTS "owners add reviewed recipients to drafts" ON public.email_campaign_recipients;
CREATE POLICY "owners add reviewed recipients to drafts" ON public.email_campaign_recipients FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.id = campaign_id
    AND c.user_id = auth.uid() AND c.status = 'draft')
  AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id
    AND c.user_id = auth.uid() AND lower(btrim(c.email)) = lower(btrim(email_snapshot))
    AND c.outreach_status <> 'blocked')
);
DROP POLICY IF EXISTS "owners remove recipients from drafts" ON public.email_campaign_recipients;
CREATE POLICY "owners remove recipients from drafts" ON public.email_campaign_recipients FOR DELETE TO authenticated
USING (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.email_campaigns c WHERE c.id = campaign_id AND c.status = 'draft'
) AND NOT EXISTS (
  SELECT 1 FROM public.email_campaign_events e
  WHERE e.recipient_id = email_campaign_recipients.id
));

DROP POLICY IF EXISTS "owners read email events" ON public.email_campaign_events;
CREATE POLICY "owners read email events" ON public.email_campaign_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.email_campaign_recipients r
  JOIN public.email_campaigns c ON c.id = r.campaign_id
  WHERE r.id = recipient_id AND
    (c.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()))
));

REVOKE ALL ON public.email_campaigns, public.email_campaign_recipients,
  public.email_campaign_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.email_campaigns TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.email_campaign_recipients TO authenticated;
GRANT SELECT ON public.email_campaign_events TO authenticated;
GRANT ALL ON public.email_campaigns, public.email_campaign_recipients,
  public.email_campaign_events TO service_role;

-- Immutable provider history: the server-side connector inserts events with
-- stable provider_event_id; replayed webhooks cannot create duplicates.
COMMENT ON TABLE public.email_campaign_events IS
  'Append-only provider events; insert by trusted service role only.';
