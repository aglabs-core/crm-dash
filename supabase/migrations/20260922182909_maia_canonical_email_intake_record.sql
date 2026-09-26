BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regnamespace('maia_email_private') IS NOT NULL OR to_regclass('public.maia_identity_pending') IS NOT NULL THEN
 RAISE EXCEPTION 'existing legacy email store or pending queue requires explicit reviewed upgrade'; END IF;
END $$;
-- REVIEW CANDIDATE ONLY. Not applied to production.
-- Incoming identity must be authenticated by privileged channel ingress.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Fresh install only. Never reinterpret intake-v2 bindings or overwrite data.
DO $$ BEGIN
 IF to_regnamespace('maia_intake_private') IS NOT NULL THEN
  RAISE EXCEPTION 'existing intake store requires explicit reviewed migration';
 END IF;
END $$;
ALTER TABLE public.contacts ALTER COLUMN name DROP NOT NULL;
CREATE SCHEMA IF NOT EXISTS maia_intake_private;
REVOKE ALL ON SCHEMA maia_intake_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS maia_intake_private.identities (
 user_id uuid NOT NULL REFERENCES auth.users(id),
 channel text NOT NULL CHECK(channel IN ('email','whatsapp','discord')),
 subject text NOT NULL,
 contact_id uuid NOT NULL REFERENCES public.contacts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,channel,subject)
);
ALTER TABLE maia_intake_private.identities ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS maia_intake_private.events (
 user_id uuid NOT NULL REFERENCES auth.users(id),channel text NOT NULL,scope text NOT NULL,event_id text NOT NULL,
 subject text NOT NULL,contact_id uuid NOT NULL REFERENCES public.contacts(id),received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,channel,scope,event_id)
);
ALTER TABLE maia_intake_private.events ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.maia_contact_intake(p_channel text,p_subject text,p_scope text,p_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; cid uuid; existing_subject text;
BEGIN
 IF p_channel IS NULL OR p_channel <> 'email'
 OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 254
 OR p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 254 OR p_scope ~ '[[:cntrl:]]'
 OR p_event IS NULL OR length(p_event) NOT BETWEEN 1 AND 512 OR p_event ~ '[[:cntrl:]]'
 OR p_scope<>btrim(p_scope) OR p_event<>btrim(p_event)
 THEN RAISE EXCEPTION 'invalid intake'; END IF;
 IF p_subject<>lower(p_subject) OR length(split_part(p_subject,'@',1))>64
 OR p_subject !~ '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
 THEN RAISE EXCEPTION 'invalid identity'; END IF;
 -- A tenant-level transaction lock gives simple deterministic race handling.
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT subject,contact_id INTO existing_subject,cid FROM maia_intake_private.events
 WHERE user_id=tenant AND channel=p_channel AND scope=p_scope AND event_id=p_event;
 IF FOUND THEN
  IF existing_subject<>p_subject THEN RAISE EXCEPTION 'event identity conflict'; END IF;
  PERFORM 1 FROM public.contacts c JOIN maia_intake_private.identities i ON i.contact_id=c.id
  WHERE c.id=cid AND c.user_id=tenant AND c.email=p_subject
  AND i.user_id=tenant AND i.channel=p_channel AND i.subject=p_subject FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'identity reconciliation required'; END IF;
  RETURN jsonb_build_object('ok',true,'contact_id',cid);
 END IF;
 SELECT contact_id INTO cid FROM maia_intake_private.identities
 WHERE user_id=tenant AND channel=p_channel AND subject=p_subject;
 IF NOT FOUND THEN
  IF EXISTS (SELECT 1 FROM public.contacts WHERE user_id=tenant AND lower(email)=p_subject) THEN
   RAISE EXCEPTION 'identity reconciliation required';
  END IF;
  INSERT INTO public.contacts(user_id,name,email,phone,whatsapp,origin,status,plano,produto,amount)
  VALUES(tenant,NULL,p_subject,NULL,NULL,NULL,'Contatado',NULL,NULL,NULL) RETURNING id INTO cid;
  INSERT INTO maia_intake_private.identities(user_id,channel,subject,contact_id) VALUES(tenant,p_channel,p_subject,cid);
 END IF;
 PERFORM 1 FROM public.contacts WHERE id=cid AND user_id=tenant AND email=p_subject FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'identity reconciliation required'; END IF;
 INSERT INTO maia_intake_private.events(user_id,channel,scope,event_id,subject,contact_id)
 VALUES(tenant,p_channel,p_scope,p_event,p_subject,cid);
 RETURN jsonb_build_object('ok',true,'contact_id',cid);
END $$;
REVOKE ALL ON FUNCTION public.maia_contact_intake(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_contact_intake(text,text,text,text) TO service_role;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.maia_identity_pending (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 channel text NOT NULL CHECK(channel IN ('email','whatsapp')), subject text NOT NULL,
 claimed_email text NOT NULL, candidate_contact_id uuid REFERENCES public.contacts(id),
 source_contact_id uuid REFERENCES public.contacts(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','dismissed')),
 resolution_note text, resolved_by uuid, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,channel,subject,claimed_email)
);
ALTER TABLE public.maia_identity_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maia_identity_pending FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.maia_identity_pending TO authenticated;
CREATE POLICY pending_owner_read ON public.maia_identity_pending FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE maia_intake_private.events ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE maia_intake_private.events ADD COLUMN pending_id uuid REFERENCES public.maia_identity_pending(id);
ALTER TABLE maia_intake_private.events ADD CONSTRAINT event_attribution CHECK ((contact_id IS NULL) <> (pending_id IS NULL));
CREATE FUNCTION maia_intake_private.pending_email(p_subject text,p_scope text,p_event text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; pid uuid; cid uuid;
BEGIN
 SELECT id INTO cid FROM public.contacts WHERE user_id=tenant AND lower(email)=p_subject;
 INSERT INTO public.maia_identity_pending(user_id,channel,subject,claimed_email,candidate_contact_id)
 VALUES(tenant,'email',p_subject,p_subject,cid)
 ON CONFLICT(user_id,channel,subject,claimed_email) DO UPDATE SET status='pending',resolved_at=NULL,resolved_by=NULL,resolution_note=NULL
 RETURNING id INTO pid;
 INSERT INTO maia_intake_private.events(user_id,channel,scope,event_id,subject,contact_id,pending_id)
 VALUES(tenant,'email',p_scope,p_event,p_subject,NULL,pid)
 ON CONFLICT(user_id,channel,scope,event_id) DO UPDATE SET contact_id=NULL,pending_id=excluded.pending_id;
 RETURN jsonb_build_object('ok',true,'status','pending','contact_id',NULL,'pending_id',pid);
END $$;
REVOKE ALL ON FUNCTION maia_intake_private.pending_email(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.maia_contact_intake(p_channel text,p_subject text,p_scope text,p_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; cid uuid; existing_subject text; pid uuid;
BEGIN
 IF p_channel IS NULL OR p_channel <> 'email'
 OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 254
 OR p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 254 OR p_scope ~ '[[:cntrl:]]'
 OR p_event IS NULL OR length(p_event) NOT BETWEEN 1 AND 512 OR p_event ~ '[[:cntrl:]]'
 OR p_scope<>btrim(p_scope) OR p_event<>btrim(p_event)
 THEN RAISE EXCEPTION 'invalid intake'; END IF;
 IF p_subject<>lower(p_subject) OR length(split_part(p_subject,'@',1))>64
 OR p_subject !~ '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
 THEN RAISE EXCEPTION 'invalid identity'; END IF;
 -- A tenant-level transaction lock gives simple deterministic race handling.
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT subject,contact_id,pending_id INTO existing_subject,cid,pid FROM maia_intake_private.events
 WHERE user_id=tenant AND channel=p_channel AND scope=p_scope AND event_id=p_event;
 IF FOUND THEN
  IF existing_subject<>p_subject THEN RAISE EXCEPTION 'event identity conflict'; END IF;
  IF pid IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'status','pending','contact_id',NULL,'pending_id',pid); END IF;
  PERFORM 1 FROM public.contacts c JOIN maia_intake_private.identities i ON i.contact_id=c.id
  WHERE c.id=cid AND c.user_id=tenant AND lower(c.email)=p_subject
  AND i.user_id=tenant AND i.channel=p_channel AND i.subject=p_subject FOR SHARE OF c;
  IF NOT FOUND THEN RETURN maia_intake_private.pending_email(p_subject,p_scope,p_event); END IF;
  RETURN jsonb_build_object('ok',true,'contact_id',cid);
 END IF;
 SELECT contact_id INTO cid FROM maia_intake_private.identities
 WHERE user_id=tenant AND channel=p_channel AND subject=p_subject;
 IF NOT FOUND THEN
  IF EXISTS (SELECT 1 FROM public.contacts WHERE user_id=tenant AND lower(email)=p_subject) THEN
   RETURN maia_intake_private.pending_email(p_subject,p_scope,p_event);
  END IF;
  INSERT INTO public.contacts(user_id,name,email,phone,whatsapp,origin,status,plano,produto,amount)
  VALUES(tenant,NULL,p_subject,NULL,NULL,NULL,'Contatado',NULL,NULL,NULL) RETURNING id INTO cid;
  INSERT INTO maia_intake_private.identities(user_id,channel,subject,contact_id) VALUES(tenant,p_channel,p_subject,cid);
 END IF;
 PERFORM 1 FROM public.contacts WHERE id=cid AND user_id=tenant AND lower(email)=p_subject FOR SHARE;
 IF NOT FOUND THEN RETURN maia_intake_private.pending_email(p_subject,p_scope,p_event); END IF;
 INSERT INTO maia_intake_private.events(user_id,channel,scope,event_id,subject,contact_id)
 VALUES(tenant,p_channel,p_scope,p_event,p_subject,cid);
 RETURN jsonb_build_object('ok',true,'contact_id',cid);
END $$;
REVOKE ALL ON FUNCTION public.maia_contact_intake(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_contact_intake(text,text,text,text) TO service_role;


-- Appended to fresh installation, not the historical private-contact migration.
ALTER TABLE public.activities ADD COLUMN maia_pending_id uuid REFERENCES public.maia_identity_pending(id);
CREATE TABLE maia_intake_private.threads (
 user_id uuid NOT NULL, mailbox text NOT NULL, thread_id text NOT NULL, subject text NOT NULL,
 PRIMARY KEY(user_id,mailbox,thread_id)
);
CREATE TABLE maia_intake_private.interactions (
 user_id uuid NOT NULL, mailbox text NOT NULL,event_id text NOT NULL,thread_id text NOT NULL,
 subject text NOT NULL,summary text NOT NULL,activity_id uuid NOT NULL REFERENCES public.activities(id),
 identity_pending boolean NOT NULL, PRIMARY KEY(user_id,mailbox,event_id),
 FOREIGN KEY(user_id,mailbox,thread_id) REFERENCES maia_intake_private.threads(user_id,mailbox,thread_id)
);
ALTER TABLE maia_intake_private.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE maia_intake_private.interactions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.maia_email_record(p_sender text,p_mailbox text,p_thread text,p_event text,p_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
 e maia_intake_private.events%ROWTYPE; old maia_intake_private.interactions%ROWTYPE; aid uuid;
BEGIN
 IF p_thread IS NULL OR length(p_thread) NOT BETWEEN 1 AND 512 OR p_thread<>btrim(p_thread) OR p_thread ~ '[[:cntrl:]]'
 OR p_summary IS NULL OR length(btrim(p_summary)) NOT BETWEEN 1 AND 1200
 OR p_summary ~* '\m(cvv|senha|password|token|chave privada|cartão|cartao)\M'
 OR regexp_replace(p_summary,'[ -]','','g') ~ '\m[0-9]{15,16}\M'
 THEN RAISE EXCEPTION 'invalid record'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 -- Record cannot create an event. Only privileged authenticated intake admits it.
 SELECT * INTO e FROM maia_intake_private.events WHERE user_id=tenant AND channel='email' AND scope=p_mailbox AND event_id=p_event;
 IF NOT FOUND OR e.subject IS DISTINCT FROM p_sender THEN RAISE EXCEPTION 'intake required'; END IF;
 -- Revalidate current canonical binding, including replay. Drift becomes pending;
 -- an already committed interaction is immutable and cannot be reassigned.
 PERFORM public.maia_contact_intake('email',p_sender,p_mailbox,p_event);
 SELECT * INTO e FROM maia_intake_private.events WHERE user_id=tenant AND channel='email' AND scope=p_mailbox AND event_id=p_event;
 SELECT * INTO old FROM maia_intake_private.interactions WHERE user_id=tenant AND mailbox=p_mailbox AND event_id=p_event;
 IF FOUND THEN
  IF old.subject IS DISTINCT FROM p_sender OR old.thread_id IS DISTINCT FROM p_thread OR old.summary IS DISTINCT FROM p_summary
   OR old.identity_pending IS DISTINCT FROM (e.pending_id IS NOT NULL) THEN RAISE EXCEPTION 'immutable interaction conflict'; END IF;
 ELSE
  INSERT INTO maia_intake_private.threads VALUES(tenant,p_mailbox,p_thread,p_sender) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM maia_intake_private.threads WHERE user_id=tenant AND mailbox=p_mailbox AND thread_id=p_thread AND subject=p_sender) THEN RAISE EXCEPTION 'thread ownership conflict'; END IF;
  INSERT INTO public.activities(user_id,contact_id,type,channel,content,maia_pending_id)
  VALUES(tenant,e.contact_id,'note','email',p_summary,e.pending_id) RETURNING id INTO aid;
  INSERT INTO maia_intake_private.interactions VALUES(tenant,p_mailbox,p_event,p_thread,p_sender,p_summary,aid,e.pending_id IS NOT NULL);
 END IF;
 RETURN jsonb_build_object('ok',true,'activity_recorded',true,'identity_pending',e.pending_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.maia_email_record(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_email_record(text,text,text,text,text) TO service_role;
-- Narrow replacement for ONLY the two contact HTTP writes in maiaCrmRecord001.
-- Same canonical phone lookup and nominal fields; email collision becomes visible pending.
CREATE OR REPLACE FUNCTION public.maia_whatsapp_contact(p_contact uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
 cid uuid; candidate uuid; ids uuid[]; claimed text; safe_email text; old public.contacts%ROWTYPE;
 statuses text[]:=ARRAY['Arquivado','Lead','Contatado','Atendimento','Proposta','Pagamento','Cliente','Inativo'];
 desired text;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR p_body->>'whatsapp' IS NULL OR p_body->>'whatsapp' !~ '^[0-9]{10,13}$'
 OR nullif(btrim(p_body->>'name'),'') IS NULL
 OR (p_body ? 'user_id' AND p_body->>'user_id' IS DISTINCT FROM tenant::text)
 OR (p_body->>'status') IS NULL OR NOT(p_body->>'status'=ANY(statuses))
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k NOT IN ('user_id','origin','name','email','phone','whatsapp','company','produto','priority','status'))
 THEN RAISE EXCEPTION 'invalid WhatsApp contact'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 -- Protect check/write from concurrent legacy writers that do not use advisory locks.
 -- Brief table-level write serialization, bounded lock timeout; no network within TX.
 LOCK TABLE public.contacts IN SHARE ROW EXCLUSIVE MODE;
 SELECT array_agg(id) INTO ids FROM public.contacts WHERE user_id=tenant AND
 (whatsapp=p_body->>'whatsapp' OR phone=p_body->>'phone' OR phone=p_body->>'whatsapp');
 IF cardinality(ids)>1 THEN RAISE EXCEPTION 'ambiguous WhatsApp phone identity'; END IF;
 cid:=ids[1];
 IF p_contact IS NOT NULL AND cid IS DISTINCT FROM p_contact THEN RAISE EXCEPTION 'WhatsApp contact scope conflict'; END IF;
 IF cid IS NOT NULL THEN SELECT * INTO old FROM public.contacts WHERE id=cid; END IF;
 claimed:=nullif(lower(p_body->>'email'),''); safe_email:=claimed;
 IF claimed IS NOT NULL THEN
  SELECT id INTO candidate FROM public.contacts WHERE user_id=tenant AND lower(email)=claimed AND id IS DISTINCT FROM cid;
  -- A verified email binding cannot be replaced by a WhatsApp supplied address.
  IF candidate IS NULL AND cid IS NOT NULL AND claimed IS DISTINCT FROM old.email
   AND EXISTS(SELECT 1 FROM maia_intake_private.identities WHERE user_id=tenant AND contact_id=cid AND channel='email') THEN candidate:=cid; END IF;
  IF candidate IS NOT NULL THEN safe_email:=old.email; END IF;
 END IF;
 desired:=p_body->>'status';
 IF array_position(statuses,old.status)>array_position(statuses,desired) THEN desired:=old.status; END IF;
 IF cid IS NULL THEN
  INSERT INTO public.contacts(user_id,origin,name,email,phone,whatsapp,company,produto,priority,status)
  VALUES(tenant,'whatsapp',p_body->>'name',safe_email,p_body->>'phone',p_body->>'whatsapp',p_body->>'company',p_body->>'produto',p_body->>'priority',desired)
  RETURNING id INTO cid;
 ELSE
  UPDATE public.contacts SET name=p_body->>'name',email=coalesce(safe_email,email),phone=coalesce(p_body->>'phone',phone),
  whatsapp=p_body->>'whatsapp',company=coalesce(p_body->>'company',company),produto=coalesce(p_body->>'produto',produto),
  priority=coalesce(p_body->>'priority',priority),status=desired WHERE id=cid AND user_id=tenant;
 END IF;
 IF candidate IS NOT NULL THEN
  INSERT INTO public.maia_identity_pending(user_id,channel,subject,claimed_email,candidate_contact_id,source_contact_id)
  VALUES(tenant,'whatsapp',p_body->>'whatsapp',claimed,candidate,cid)
  ON CONFLICT(user_id,channel,subject,claimed_email) DO UPDATE SET source_contact_id=excluded.source_contact_id,status='pending';
 END IF;
 RETURN jsonb_build_array(jsonb_build_object('id',cid));
END $$;
REVOKE ALL ON FUNCTION public.maia_whatsapp_contact(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_whatsapp_contact(uuid,jsonb) TO service_role;
CREATE TABLE maia_intake_private.reconciliation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pending_id uuid NOT NULL REFERENCES public.maia_identity_pending(id),
 actor uuid NOT NULL,contact_id uuid NOT NULL REFERENCES public.contacts(id),evidence_note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE maia_intake_private.reconciliation_audit ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.maia_resolve_email_pending(p_pending uuid,p_contact uuid,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; item public.maia_identity_pending%ROWTYPE;
BEGIN
 IF auth.uid() IS DISTINCT FROM tenant THEN RAISE EXCEPTION 'owner authorization required'; END IF;
 IF p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'independent verification evidence required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT * INTO item FROM public.maia_identity_pending WHERE id=p_pending AND user_id=tenant FOR UPDATE;
 IF NOT FOUND OR item.channel<>'email' OR item.status<>'pending' THEN RAISE EXCEPTION 'pending email required'; END IF;
 PERFORM 1 FROM public.contacts WHERE id=p_contact AND user_id=tenant AND lower(email)=item.subject FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'canonical email mismatch'; END IF;
 -- Exact same binding may be renewed; never steal an existing different binding.
 INSERT INTO maia_intake_private.identities(user_id,channel,subject,contact_id)
 VALUES(tenant,'email',item.subject,p_contact) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM maia_intake_private.identities WHERE user_id=tenant AND channel='email' AND subject=item.subject AND contact_id=p_contact) THEN RAISE EXCEPTION 'binding conflict requires separate reviewed repair'; END IF;
 INSERT INTO maia_intake_private.reconciliation_audit(pending_id,actor,contact_id,evidence_note) VALUES(p_pending,auth.uid(),p_contact,p_evidence);
 UPDATE public.maia_identity_pending SET status='verified',resolved_by=auth.uid(),resolved_at=now(),resolution_note=p_evidence WHERE id=p_pending;
 RETURN jsonb_build_object('ok',true,'future_binding_only',true);
END $$;
REVOKE ALL ON FUNCTION public.maia_resolve_email_pending(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.maia_resolve_email_pending(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
