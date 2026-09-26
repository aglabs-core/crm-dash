BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE maia_intake_private.interactions ADD COLUMN escalation_requested boolean NOT NULL DEFAULT false;
CREATE TABLE public.maia_email_escalations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id), mailbox text NOT NULL, event_id text NOT NULL,
 contact_id uuid REFERENCES public.contacts(id), pending_id uuid REFERENCES public.maia_identity_pending(id),
 activity_id uuid NOT NULL REFERENCES public.activities(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((contact_id IS NULL) <> (pending_id IS NULL)),
 UNIQUE(user_id,mailbox,event_id),
 FOREIGN KEY(user_id,mailbox,event_id) REFERENCES maia_intake_private.interactions(user_id,mailbox,event_id)
);
ALTER TABLE public.maia_email_escalations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maia_email_escalations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.maia_email_escalations TO authenticated;
CREATE POLICY escalation_owner_read ON public.maia_email_escalations FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.maia_email_record_v2(p_sender text,p_mailbox text,p_thread text,p_event text,p_summary text,p_escalate boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; old maia_intake_private.interactions%ROWTYPE; receipt jsonb;
BEGIN
 IF p_escalate IS NULL THEN RAISE EXCEPTION 'explicit escalation decision required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT * INTO old FROM maia_intake_private.interactions WHERE user_id=tenant AND mailbox=p_mailbox AND event_id=p_event;
 IF FOUND AND old.escalation_requested IS DISTINCT FROM p_escalate THEN RAISE EXCEPTION 'immutable escalation conflict'; END IF;
 receipt:=public.maia_email_record(p_sender,p_mailbox,p_thread,p_event,p_summary);
 IF old.event_id IS NULL THEN
  UPDATE maia_intake_private.interactions SET escalation_requested=p_escalate WHERE user_id=tenant AND mailbox=p_mailbox AND event_id=p_event;
  IF p_escalate THEN
   INSERT INTO public.maia_email_escalations(user_id,mailbox,event_id,contact_id,pending_id,activity_id,status)
   SELECT tenant,p_mailbox,p_event,a.contact_id,a.maia_pending_id,a.id,'pending'
   FROM maia_intake_private.interactions i JOIN public.activities a ON a.id=i.activity_id
   WHERE i.user_id=tenant AND i.mailbox=p_mailbox AND i.event_id=p_event;
  END IF;
 END IF;
 RETURN receipt||jsonb_build_object('escalation_pending',p_escalate);
END $$;
REVOKE ALL ON FUNCTION public.maia_email_record_v2(text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_email_record_v2(text,text,text,text,text,boolean) TO service_role;
CREATE TABLE maia_intake_private.history_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id), mailbox text NOT NULL, subject text NOT NULL,
 contact_id uuid NOT NULL REFERENCES public.contacts(id), target_thread text NOT NULL,
 allowed_threads text[], actor uuid NOT NULL, evidence_note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_decision_scope ON maia_intake_private.history_decisions(user_id,mailbox,subject,target_thread,id DESC);
ALTER TABLE maia_intake_private.history_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maia_intake_private.history_decisions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.maia_email_history_decide(p_sender text,p_mailbox text,p_thread text,p_allowed text[],p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; cid uuid;
BEGIN
 IF auth.uid() IS DISTINCT FROM tenant THEN RAISE EXCEPTION 'owner authorization required'; END IF;
 IF p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'verification evidence required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT i.contact_id INTO cid FROM maia_intake_private.identities i JOIN public.contacts c ON c.id=i.contact_id
 WHERE i.user_id=tenant AND i.channel='email' AND i.subject=p_sender AND c.user_id=tenant AND lower(c.email)=p_sender FOR SHARE OF c;
 IF p_allowed IS NULL THEN
  SELECT contact_id INTO cid FROM maia_intake_private.history_decisions WHERE user_id=tenant AND mailbox=p_mailbox AND subject=p_sender AND target_thread=p_thread ORDER BY id DESC LIMIT 1;
 END IF;
 IF cid IS NULL THEN RAISE EXCEPTION 'verified canonical binding required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM maia_intake_private.threads WHERE user_id=tenant AND mailbox=p_mailbox AND thread_id=p_thread AND subject=p_sender) THEN RAISE EXCEPTION 'target thread ownership required'; END IF;
 IF p_allowed IS NOT NULL AND (cardinality(p_allowed)>20 OR array_ndims(p_allowed)>1 OR EXISTS(
  SELECT 1 FROM unnest(p_allowed) t WHERE t IS NULL OR t=p_thread OR NOT EXISTS(
   SELECT 1 FROM maia_intake_private.threads th JOIN maia_intake_private.interactions i USING(user_id,mailbox,thread_id)
   JOIN public.activities a ON a.id=i.activity_id
   WHERE th.user_id=tenant AND th.mailbox=p_mailbox AND th.thread_id=t AND th.subject=p_sender
   AND i.subject=p_sender AND NOT i.identity_pending AND a.contact_id=cid AND a.user_id=tenant)))
 THEN RAISE EXCEPTION 'ineligible history thread'; END IF;
 INSERT INTO maia_intake_private.history_decisions(user_id,mailbox,subject,contact_id,target_thread,allowed_threads,actor,evidence_note)
 VALUES(tenant,p_mailbox,p_sender,cid,p_thread,p_allowed,auth.uid(),p_evidence);
 RETURN jsonb_build_object('ok',true,'revoked',p_allowed IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.maia_email_history_decide(text,text,text,text[],text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.maia_email_history_decide(text,text,text,text[],text) TO authenticated;
CREATE FUNCTION public.maia_email_history(p_sender text,p_mailbox text,p_thread text,p_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; cid uuid; d maia_intake_private.history_decisions%ROWTYPE; summaries jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT e.contact_id INTO cid FROM maia_intake_private.events e
 JOIN maia_intake_private.identities i ON i.user_id=e.user_id AND i.channel=e.channel AND i.subject=e.subject AND i.contact_id=e.contact_id
 JOIN public.contacts c ON c.id=i.contact_id
 WHERE e.user_id=tenant AND e.channel='email' AND e.scope=p_mailbox AND e.event_id=p_event AND e.subject=p_sender AND e.pending_id IS NULL
 AND c.user_id=tenant AND lower(c.email)=p_sender FOR SHARE OF c;
 IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM maia_intake_private.threads WHERE user_id=tenant AND mailbox=p_mailbox AND thread_id=p_thread AND subject=p_sender)
 OR EXISTS(SELECT 1 FROM maia_intake_private.interactions WHERE user_id=tenant AND mailbox=p_mailbox AND event_id=p_event AND thread_id<>p_thread)
 THEN RETURN jsonb_build_object('ok',false,'error','history_not_authorized'); END IF;
 SELECT * INTO d FROM maia_intake_private.history_decisions WHERE user_id=tenant AND mailbox=p_mailbox AND subject=p_sender AND target_thread=p_thread ORDER BY id DESC LIMIT 1;
 IF d.id IS NULL OR d.allowed_threads IS NULL OR d.contact_id<>cid THEN RETURN jsonb_build_object('ok',false,'error','history_not_authorized'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('summary',s.summary,'recorded_at',s.received_at) ORDER BY s.received_at DESC,s.activity_id DESC),'[]'::jsonb) INTO summaries FROM (
  SELECT i.summary,e.received_at,i.activity_id FROM maia_intake_private.interactions i
  JOIN maia_intake_private.threads t USING(user_id,mailbox,thread_id)
  JOIN maia_intake_private.events e ON e.user_id=i.user_id AND e.channel='email' AND e.scope=i.mailbox AND e.event_id=i.event_id
  JOIN public.activities a ON a.id=i.activity_id
  WHERE i.user_id=tenant AND i.mailbox=p_mailbox AND i.subject=p_sender AND t.subject=p_sender
   AND i.thread_id<>p_thread AND i.thread_id=ANY(d.allowed_threads) AND NOT i.identity_pending
   AND e.subject=p_sender AND e.contact_id=cid AND e.pending_id IS NULL AND a.user_id=tenant AND a.contact_id=cid
  ORDER BY e.received_at DESC,i.activity_id DESC LIMIT 10
 ) s;
 RETURN jsonb_build_object('ok',true,'summaries',summaries);
END $$;
REVOKE ALL ON FUNCTION public.maia_email_history(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_email_history(text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
