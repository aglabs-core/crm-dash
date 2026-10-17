-- Brevo delivery results were never received by the CRM. Add an isolated,
-- minimal event inbox and service-only ingestion; email bodies and raw payloads
-- are never stored. Unknown messages stay pending instead of creating leads.
CREATE TABLE IF NOT EXISTS public.email_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'brevo' CHECK (provider = 'brevo'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  last_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);
CREATE TABLE IF NOT EXISTS public.email_provider_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.email_provider_connections(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (event_key ~ '^[a-f0-9]{64}$'),
  message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 1000),
  address_key text NOT NULL CHECK (address_key ~ '^[a-f0-9]{64}$'),
  provider_type text NOT NULL CHECK (length(provider_type) BETWEEN 1 AND 100),
  event_type text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  recipient_id uuid REFERENCES public.email_campaign_recipients(id) ON DELETE SET NULL,
  processing_state text NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'matched', 'ignored')),
  UNIQUE(connection_id,event_key)
);
CREATE INDEX IF NOT EXISTS email_provider_inbox_pending_idx ON public.email_provider_event_inbox(connection_id,message_id,address_key) WHERE processing_state='pending';
CREATE TABLE IF NOT EXISTS public.email_provider_suppressions (
  connection_id uuid NOT NULL REFERENCES public.email_provider_connections(id) ON DELETE CASCADE,
  address_key text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribed','spam','hard_bounce','invalid_email')),
  last_event_at timestamptz NOT NULL,
  PRIMARY KEY(connection_id,address_key)
);
ALTER TABLE public.email_campaign_events ADD COLUMN IF NOT EXISTS provider_event_type text;
ALTER TABLE public.email_campaign_events DROP CONSTRAINT IF EXISTS email_campaign_events_event_type_check;
ALTER TABLE public.email_campaign_events ADD CONSTRAINT email_campaign_events_event_type_check CHECK (
  event_type IN ('sent','delivered','opened','clicked','replied','bounced','complained','unsubscribed','deferred','blocked','error','proxy_open')
);
ALTER TABLE public.email_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads connection" ON public.email_provider_connections;
CREATE POLICY "owner reads connection" ON public.email_provider_connections FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "owner prepares connection" ON public.email_provider_connections;
CREATE POLICY "owner prepares connection" ON public.email_provider_connections FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND last_received_at IS NULL);
DROP POLICY IF EXISTS "owner reads event inbox" ON public.email_provider_event_inbox;
CREATE POLICY "owner reads event inbox" ON public.email_provider_event_inbox FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.email_provider_connections c WHERE c.id=connection_id AND c.user_id=auth.uid())
);
DROP POLICY IF EXISTS "owner reads suppression" ON public.email_provider_suppressions;
CREATE POLICY "owner reads suppression" ON public.email_provider_suppressions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.email_provider_connections c WHERE c.id=connection_id AND c.user_id=auth.uid())
);
REVOKE ALL ON public.email_provider_connections,public.email_provider_event_inbox,public.email_provider_suppressions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.email_provider_connections TO authenticated;
GRANT SELECT ON public.email_provider_event_inbox,public.email_provider_suppressions TO authenticated;
GRANT ALL ON public.email_provider_connections,public.email_provider_event_inbox,public.email_provider_suppressions TO service_role;

CREATE OR REPLACE FUNCTION public.brevo_address_key(connection uuid,address text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT encode(sha256(convert_to(connection::text || ':' || lower(btrim(address)), 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public.brevo_address_key(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brevo_address_key(uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.campaign_email_is_suppressed(address text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.email_campaign_events e JOIN public.email_campaign_recipients r ON r.id=e.recipient_id
    WHERE r.user_id=auth.uid() AND lower(btrim(r.email_snapshot))=lower(btrim(address)) AND e.event_type IN ('unsubscribed','complained'))
    OR EXISTS (SELECT 1 FROM public.email_provider_suppressions s JOIN public.email_provider_connections c ON c.id=s.connection_id
      WHERE c.user_id=auth.uid() AND s.address_key=public.brevo_address_key(c.id,address));
END
$$;
REVOKE ALL ON FUNCTION public.campaign_email_is_suppressed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campaign_email_is_suppressed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_brevo_inbox(p_event_id uuid,p_recipient_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.email_provider_event_inbox; campaign_id uuid;
BEGIN
  SELECT * INTO STRICT e FROM public.email_provider_event_inbox WHERE id=p_event_id FOR UPDATE;
  SELECT c.id INTO campaign_id FROM public.email_campaign_recipients r
    JOIN public.email_campaigns c ON c.id=r.campaign_id
    JOIN public.email_provider_connections connection ON connection.id=e.connection_id
    WHERE r.id=p_recipient_id AND c.provider='brevo' AND c.user_id=connection.user_id AND r.user_id=connection.user_id
      AND btrim(r.provider_message_id,'<> ')=e.message_id AND public.brevo_address_key(connection.id,r.email_snapshot)=e.address_key;
  IF NOT FOUND OR e.event_type IS NULL THEN RAISE EXCEPTION 'Association unavailable'; END IF;
  INSERT INTO public.email_campaign_events(recipient_id,event_type,provider_event_type,provider_event_id,occurred_at)
    VALUES (p_recipient_id,e.event_type,e.provider_type,'brevo:' || e.event_key,e.occurred_at)
    ON CONFLICT (recipient_id,provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;
  UPDATE public.email_provider_event_inbox SET recipient_id=p_recipient_id,processing_state='matched' WHERE id=e.id;
  IF e.event_type IN ('sent','delivered') THEN
    UPDATE public.email_campaigns SET status='active',updated_at=now() WHERE id=campaign_id AND status='draft';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.apply_brevo_inbox(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_brevo_inbox(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_brevo_events(p_connection_id uuid,p_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.email_provider_connections; item jsonb; eid uuid; message text; email text; address text;
  kind text; raw_kind text; happened timestamptz; target uuid; matches integer;
BEGIN
  SELECT * INTO STRICT connection FROM public.email_provider_connections WHERE id=p_connection_id FOR UPDATE;
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    message := btrim(item->>'message_id','<> '); email := lower(btrim(item->>'email'));
    raw_kind := item->>'provider_type'; kind := item->>'event_type'; happened := (item->>'occurred_at')::timestamptz;
    IF message IS NULL OR length(message) NOT BETWEEN 1 AND 1000 OR email IS NULL OR length(email)>320
      OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR raw_kind IS NULL OR length(raw_kind) NOT BETWEEN 1 AND 100
      OR happened IS NULL OR happened<'2000-01-01'::timestamptz OR happened>now()+interval '5 minutes'
      OR (kind IS NOT NULL AND kind NOT IN ('sent','delivered','opened','clicked','bounced','complained','unsubscribed','deferred','blocked','error','proxy_open'))
      THEN RAISE EXCEPTION 'Invalid normalized event'; END IF;
    address := public.brevo_address_key(connection.id,email);
    eid := NULL;
    INSERT INTO public.email_provider_event_inbox(connection_id,event_key,message_id,address_key,provider_type,event_type,occurred_at,processing_state)
      VALUES (connection.id,item->>'event_key',message,address,raw_kind,kind,happened,CASE WHEN kind IS NULL THEN 'ignored' ELSE 'pending' END)
      ON CONFLICT(connection_id,event_key) DO NOTHING RETURNING id INTO eid;
    IF eid IS NULL THEN CONTINUE; END IF;
    IF raw_kind IN ('unsubscribed','spam','hard_bounce','invalid_email') THEN
      INSERT INTO public.email_provider_suppressions(connection_id,address_key,reason,last_event_at) VALUES(connection.id,address,raw_kind,happened)
      ON CONFLICT(connection_id,address_key) DO UPDATE SET
        reason=CASE WHEN public.email_provider_suppressions.reason IN ('spam','unsubscribed') THEN public.email_provider_suppressions.reason ELSE excluded.reason END,
        last_event_at=greatest(public.email_provider_suppressions.last_event_at,excluded.last_event_at);
    END IF;
    IF kind IS NULL THEN CONTINUE; END IF;
    SELECT count(*),(array_agg(r.id))[1] INTO matches,target FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id
      WHERE c.provider='brevo' AND c.user_id=connection.user_id AND r.user_id=connection.user_id
        AND btrim(r.provider_message_id,'<> ')=message AND lower(btrim(r.email_snapshot))=email;
    IF matches=1 THEN PERFORM public.apply_brevo_inbox(eid,target); END IF;
  END LOOP;
  UPDATE public.email_provider_connections SET last_received_at=now() WHERE id=connection.id;
END
$$;
REVOKE ALL ON FUNCTION public.ingest_brevo_events(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_brevo_events(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.associate_brevo_message(p_connection_id uuid,p_actor_id uuid,p_recipient_id uuid,p_message_id text) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.email_provider_connections; recipient public.email_campaign_recipients; item record; matched integer:=0; message text;
BEGIN
  SELECT * INTO STRICT connection FROM public.email_provider_connections WHERE id=p_connection_id AND user_id=p_actor_id FOR UPDATE;
  SELECT r.* INTO STRICT recipient FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id
    WHERE r.id=p_recipient_id AND r.user_id=p_actor_id AND c.user_id=p_actor_id AND c.provider='brevo' FOR UPDATE OF r;
  message:=btrim(p_message_id,'<> ');
  IF message IS NULL OR length(message) NOT BETWEEN 1 AND 1000 OR message ~ E'[\\r\\n]' THEN RAISE EXCEPTION 'Invalid message'; END IF;
  IF recipient.provider_message_id IS NOT NULL AND btrim(recipient.provider_message_id,'<> ')<>message THEN RAISE EXCEPTION 'Message already associated'; END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.user_id=p_actor_id AND r.id<>recipient.id
    AND btrim(r.provider_message_id,'<> ')=message AND lower(btrim(r.email_snapshot))=lower(btrim(recipient.email_snapshot))) THEN RAISE EXCEPTION 'Ambiguous message'; END IF;
  UPDATE public.email_campaign_recipients SET provider_message_id=message WHERE id=recipient.id;
  FOR item IN SELECT id FROM public.email_provider_event_inbox WHERE connection_id=connection.id AND message_id=message
    AND address_key=public.brevo_address_key(connection.id,recipient.email_snapshot) AND processing_state='pending' ORDER BY id LOOP
    PERFORM public.apply_brevo_inbox(item.id,recipient.id); matched:=matched+1;
  END LOOP;
  RETURN matched;
END
$$;
REVOKE ALL ON FUNCTION public.associate_brevo_message(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.associate_brevo_message(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.brevo_connection_health() RETURNS TABLE(
  id uuid,name text,last_received_at timestamptz,total_events bigint,pending_events bigint,ignored_events bigint
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT c.id,c.name,c.last_received_at,count(e.id),count(e.id) FILTER (WHERE e.processing_state='pending'),count(e.id) FILTER (WHERE e.processing_state='ignored')
    FROM public.email_provider_connections c LEFT JOIN public.email_provider_event_inbox e ON e.connection_id=c.id
    WHERE c.user_id=auth.uid() GROUP BY c.id
$$;
REVOKE ALL ON FUNCTION public.brevo_connection_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brevo_connection_health() TO authenticated;

-- A message ID is already provider history, even before its first webhook.
-- Preserve the reviewed content and recipient while delivery is still pending.
CREATE OR REPLACE FUNCTION public.guard_email_campaign_provider_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user='authenticated' AND EXISTS (
    SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id=OLD.id
      AND (r.provider_message_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.recipient_id=r.id))
  ) THEN RAISE EXCEPTION 'Campaign has provider history'; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.guard_email_campaign_provider_history() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_email_campaign_provider_history ON public.email_campaigns;
CREATE TRIGGER guard_email_campaign_provider_history BEFORE UPDATE ON public.email_campaigns
FOR EACH ROW EXECUTE FUNCTION public.guard_email_campaign_provider_history();
DROP POLICY IF EXISTS "owners remove recipients from drafts" ON public.email_campaign_recipients;
CREATE POLICY "owners remove recipients from drafts" ON public.email_campaign_recipients FOR DELETE TO authenticated
USING (user_id=auth.uid() AND provider_message_id IS NULL
  AND EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.id=campaign_id AND c.status='draft'));

CREATE OR REPLACE FUNCTION public.guard_email_recipient_provider_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user='authenticated' AND (OLD.provider_message_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.email_campaign_events e WHERE e.recipient_id=OLD.id
  )) THEN RAISE EXCEPTION 'Recipient has provider history'; END IF;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION public.guard_email_recipient_provider_history() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_email_recipient_provider_history ON public.email_campaign_recipients;
CREATE TRIGGER guard_email_recipient_provider_history BEFORE DELETE ON public.email_campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public.guard_email_recipient_provider_history();
