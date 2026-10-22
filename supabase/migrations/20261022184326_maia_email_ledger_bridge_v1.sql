BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Read-only authorization: never call intake here (it can create pending rows).
CREATE OR REPLACE FUNCTION crm_ledger_private.maia_scope_v1(
 p_sender text,p_mailbox text,p_thread_id text,p_event_id text,p_reference_ids text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cid uuid;
BEGIN
 IF p_sender IS NULL OR length(p_sender)>254 OR p_sender<>lower(p_sender)
 OR length(split_part(p_sender,'@',1))>64
 OR p_sender !~ '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
 OR p_mailbox IS NULL OR length(p_mailbox) NOT BETWEEN 1 AND 254 OR p_mailbox<>btrim(p_mailbox) OR p_mailbox ~ '[[:cntrl:]]'
 OR p_thread_id IS NULL OR length(p_thread_id) NOT BETWEEN 1 AND 512 OR p_thread_id<>btrim(p_thread_id) OR p_thread_id ~ '[[:cntrl:]]'
 OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 512 OR p_event_id<>btrim(p_event_id) OR p_event_id ~ '[[:cntrl:]]'
 OR p_reference_ids IS NULL OR cardinality(p_reference_ids)>20 OR coalesce(array_ndims(p_reference_ids),1)<>1
 OR EXISTS(SELECT 1 FROM unnest(p_reference_ids) r WHERE r IS NULL OR length(r) NOT BETWEEN 5 AND 998 OR r !~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$')
 THEN RAISE EXCEPTION 'invalid ledger scope'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(crm_ledger_private.tenant()::text,0));
 SELECT e.contact_id INTO cid FROM maia_intake_private.events e
 JOIN maia_intake_private.identities i ON i.user_id=e.user_id AND i.channel=e.channel AND i.subject=e.subject AND i.contact_id=e.contact_id
 JOIN public.contacts c ON c.id=e.contact_id
 WHERE e.user_id=crm_ledger_private.tenant() AND e.channel='email' AND e.scope=p_mailbox AND e.event_id=p_event_id
 AND e.subject=p_sender AND e.pending_id IS NULL AND crm_ledger_private.intake_contact(c.id,p_sender)
 AND lower(c.email)=p_sender FOR SHARE OF e,i,c;
 IF cid IS NULL OR EXISTS(SELECT 1 FROM maia_intake_private.threads WHERE user_id=crm_ledger_private.tenant() AND mailbox=p_mailbox AND thread_id=p_thread_id AND subject IS DISTINCT FROM p_sender)
 OR EXISTS(SELECT 1 FROM maia_intake_private.interactions WHERE user_id=crm_ledger_private.tenant() AND mailbox=p_mailbox AND event_id=p_event_id
 AND (thread_id IS DISTINCT FROM p_thread_id OR subject IS DISTINCT FROM p_sender OR identity_pending))
 THEN RAISE EXCEPTION 'ledger scope not authorized'; END IF;
 RETURN cid;
END $$;
REVOKE ALL ON FUNCTION crm_ledger_private.maia_scope_v1(text,text,text,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.maia_email_ledger_context_v1(
 p_sender text,p_mailbox text,p_thread_id text,p_event_id text,p_reference_ids text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE cid uuid; m public.email_messages;
BEGIN
 cid:=crm_ledger_private.maia_scope_v1(p_sender,p_mailbox,p_thread_id,p_event_id,p_reference_ids);
 SELECT * INTO m FROM public.email_messages WHERE user_id=crm_ledger_private.tenant() AND contact_id=cid
 AND direction='outbound' AND address=p_sender AND rfc_message_id=ANY(p_reference_ids)
 ORDER BY sent_at DESC,id DESC LIMIT 1 FOR SHARE;
 IF m.id IS NULL THEN RETURN jsonb_build_object('version',1,'status','unknown'); END IF;
 RETURN jsonb_build_object('version',1,'status','found','match','thread','replying_to',jsonb_build_object(
 'category',m.category,'source',m.source_key,'product',m.product,'subject',m.subject,'summary',m.summary,'sent_at',m.sent_at,'status',m.status));
END $$;
REVOKE ALL ON FUNCTION public.maia_email_ledger_context_v1(text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_email_ledger_context_v1(text,text,text,text,text[]) TO service_role;
-- One immutable request per admitted event and per tenant RFC ID. No runtime
-- role can read/write snapshots directly; SECURITY DEFINER owns this boundary.
CREATE TABLE crm_ledger_private.maia_reply_snapshots (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 mailbox text NOT NULL,event_id text NOT NULL,rfc_message_id text NOT NULL,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 digest bytea NOT NULL CHECK(octet_length(digest)=32),receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,mailbox,event_id),UNIQUE(user_id,rfc_message_id)
);
ALTER TABLE crm_ledger_private.maia_reply_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_ledger_private.maia_reply_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.maia_email_ledger_reply_v1(
 p_sender text,p_mailbox text,p_thread_id text,p_event_id text,p_reference_ids text[],
 p_rfc_message_id text,p_subject text,p_summary text,p_received_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE cid uuid; receipt jsonb; payload jsonb; digest bytea;
 old crm_ledger_private.maia_reply_snapshots; original public.email_messages; inbound public.email_messages;
BEGIN
 cid:=crm_ledger_private.maia_scope_v1(p_sender,p_mailbox,p_thread_id,p_event_id,p_reference_ids);
 IF NOT EXISTS(SELECT 1 FROM maia_intake_private.interactions i
 JOIN maia_intake_private.threads t USING(user_id,mailbox,thread_id)
 JOIN public.activities a ON a.id=i.activity_id
 WHERE i.user_id=crm_ledger_private.tenant() AND i.mailbox=p_mailbox AND i.event_id=p_event_id
 AND i.thread_id=p_thread_id AND i.subject=p_sender AND t.subject=p_sender AND NOT i.identity_pending
 AND i.summary=p_summary AND a.user_id=i.user_id AND a.contact_id=cid AND a.maia_pending_id IS NULL
 AND a.channel='email' AND a.content=p_summary)
 THEN RAISE EXCEPTION 'successful interaction required'; END IF;
 IF p_rfc_message_id IS NULL OR length(p_rfc_message_id) NOT BETWEEN 5 AND 998
 OR p_rfc_message_id !~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'
 OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 300 OR p_subject<>btrim(p_subject) OR p_subject ~ '[[:cntrl:]]'
 OR p_summary IS NULL OR length(p_summary) NOT BETWEEN 1 AND 1200 OR btrim(p_summary)=''
 OR p_received_at IS NULL OR NOT isfinite(p_received_at) OR p_received_at>now()+interval '5 minutes'
 THEN RAISE EXCEPTION 'invalid ledger reply'; END IF;
 -- Serialize tenant RFC IDs, not just sender addresses: the legacy unique key
 -- spans all mailboxes and counterpart addresses in this tenant.
 PERFORM pg_advisory_xact_lock(hashtextextended('maia-ledger-rfc:'||crm_ledger_private.tenant()::text||':'||p_rfc_message_id,0));
 payload:=jsonb_build_object('sender',p_sender,'mailbox',p_mailbox,'thread_id',p_thread_id,'event_id',p_event_id,
 'reference_ids',to_jsonb(p_reference_ids),'rfc_message_id',p_rfc_message_id,'subject',p_subject,'summary',p_summary,
 'received_at',to_char(p_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'contact_id',cid);
 digest:=sha256(convert_to(payload::text,'UTF8'));
 SELECT * INTO old FROM crm_ledger_private.maia_reply_snapshots WHERE user_id=crm_ledger_private.tenant()
 AND ((mailbox=p_mailbox AND event_id=p_event_id) OR rfc_message_id=p_rfc_message_id) FOR UPDATE;
 IF FOUND THEN
  IF old.payload IS DISTINCT FROM payload OR old.digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'immutable ledger reply conflict'; END IF;
  IF old.receipt->>'status'='unmatched' THEN RETURN old.receipt; END IF;
 END IF;
 SELECT * INTO original FROM public.email_messages WHERE user_id=crm_ledger_private.tenant()
 AND direction='outbound' AND address=p_sender AND rfc_message_id=ANY(p_reference_ids)
 ORDER BY sent_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF original.id IS NOT NULL AND original.contact_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'outbound canonical binding conflict'; END IF;
 SELECT * INTO inbound FROM public.email_messages WHERE user_id=crm_ledger_private.tenant() AND rfc_message_id=p_rfc_message_id FOR UPDATE;
 IF old.event_id IS NOT NULL AND inbound.id IS NULL THEN RAISE EXCEPTION 'ledger reply evidence missing'; END IF;
 IF original.id IS NULL AND inbound.id IS NOT NULL THEN RAISE EXCEPTION 'existing RFC message conflict'; END IF;
 IF original.id IS NULL THEN receipt:=jsonb_build_object('version',1,'ok',true,'status','unmatched');
 ELSE
  -- A single already-validated RFC removes the legacy address/recent fallback
  -- and ambiguous multi-reference ordering from this privileged path.
  receipt:=public.maia_email_reply_record(p_sender,ARRAY[original.rfc_message_id],p_rfc_message_id,p_subject,left(p_summary,800),p_received_at);
  IF receipt->>'status' NOT IN ('recorded','duplicate') OR receipt->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'invalid ledger receipt'; END IF;
  -- The old writer may wait on its sender lock after our first read. Read
  -- back even a duplicate receipt: another legacy writer may have committed.
  SELECT * INTO inbound FROM public.email_messages WHERE user_id=crm_ledger_private.tenant() AND rfc_message_id=p_rfc_message_id FOR UPDATE;
  -- Legacy duplicate receipts alone are not proof. Verify the immutable row,
  -- canonical counterpart and the exact referenced outbound relationship.
  IF inbound.id IS NULL OR inbound.direction IS DISTINCT FROM 'inbound' OR inbound.provider IS DISTINCT FROM 'mailbox'
  OR inbound.contact_id IS DISTINCT FROM cid OR inbound.address IS DISTINCT FROM p_sender
  OR inbound.subject IS DISTINCT FROM p_subject OR inbound.summary IS DISTINCT FROM btrim(left(p_summary,800))
  OR inbound.sent_at IS DISTINCT FROM p_received_at OR inbound.status_at IS DISTINCT FROM p_received_at
  OR inbound.in_reply_to_message_id IS DISTINCT FROM original.id OR inbound.source_key IS DISTINCT FROM 'maia.reply'
  OR inbound.category IS DISTINCT FROM 'atendimento' OR inbound.status IS DISTINCT FROM 'received'
  OR inbound.product IS DISTINCT FROM original.product OR inbound.campaign_id IS DISTINCT FROM original.campaign_id
  OR inbound.recipient_id IS NOT NULL OR inbound.body_text IS NOT NULL OR inbound.body_html IS NOT NULL
  THEN RAISE EXCEPTION 'existing RFC message conflict'; END IF;
  receipt:=jsonb_build_object('version',1,'ok',true,'status',receipt->>'status','match','thread');
 END IF;
 IF old.event_id IS NULL THEN
  INSERT INTO crm_ledger_private.maia_reply_snapshots(user_id,mailbox,event_id,rfc_message_id,contact_id,payload,digest,receipt)
  VALUES(crm_ledger_private.tenant(),p_mailbox,p_event_id,p_rfc_message_id,cid,payload,digest,receipt);
 END IF;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.maia_email_ledger_reply_v1(text,text,text,text,text[],text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_email_ledger_reply_v1(text,text,text,text,text[],text,text,text,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
