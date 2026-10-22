-- CRM candidate, NOT Barberias Prisma migration. Review before any production DDL.
-- No publisher row/credential enabled by this migration. Separate explicit binding required.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA maia_outbound_private;
REVOKE ALL ON SCHEMA maia_outbound_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE maia_outbound_private.publishers (
 id text PRIMARY KEY, mailbox text NOT NULL, provider_account text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 CHECK (mailbox=lower(mailbox) AND length(mailbox) BETWEEN 3 AND 254),
 CHECK (length(id) BETWEEN 1 AND 100 AND length(provider_account) BETWEEN 1 AND 100)
);
CREATE FUNCTION maia_outbound_private.publisher_binding_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.mailbox IS DISTINCT FROM OLD.mailbox OR NEW.provider_account IS DISTINCT FROM OLD.provider_account THEN RAISE EXCEPTION 'immutable publisher binding'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publisher_binding_immutable BEFORE UPDATE ON maia_outbound_private.publishers FOR EACH ROW EXECUTE FUNCTION maia_outbound_private.publisher_binding_immutable();
CREATE TABLE maia_outbound_private.erased_snapshots (
 publisher_id text NOT NULL REFERENCES maia_outbound_private.publishers(id), snapshot_id text NOT NULL,
 PRIMARY KEY(publisher_id,snapshot_id), CHECK(length(snapshot_id) BETWEEN 1 AND 100)
);
ALTER TABLE maia_outbound_private.erased_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maia_outbound_private.erased_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE maia_outbound_private.trial_messages (
 publisher_id text NOT NULL REFERENCES maia_outbound_private.publishers(id),
 snapshot_id text NOT NULL, provider_email_id uuid NOT NULL, rfc_message_id text NOT NULL,
 recipient text NOT NULL, stage text NOT NULL,
 accepted_at timestamptz NOT NULL, content_digest text NOT NULL, rfc_source text NOT NULL,
 approved_summary text NOT NULL, offer_present boolean NOT NULL, offer_summary text,
 PRIMARY KEY(publisher_id,snapshot_id),
 UNIQUE(publisher_id,provider_email_id), UNIQUE(publisher_id,rfc_message_id),
 CHECK (length(snapshot_id) BETWEEN 1 AND 100),
 CHECK (recipient=lower(recipient) AND length(recipient) BETWEEN 3 AND 254 AND recipient !~ '[[:cntrl:]]'),
 CHECK (length(rfc_message_id) BETWEEN 5 AND 998 AND rfc_message_id ~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$'),
 CHECK (stage IN ('inicio','meio','ultimo-dia','encerrado','recuperacao','ultima-chance')),
 CHECK (content_digest ~ '^[0-9a-f]{64}$'), CHECK (rfc_source='resend-retrieve-v1')
);
ALTER TABLE maia_outbound_private.publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE maia_outbound_private.trial_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA maia_outbound_private FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION maia_outbound_private.reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable outbound evidence'; END $$;
CREATE TRIGGER trial_message_immutable BEFORE UPDATE ON maia_outbound_private.trial_messages FOR EACH ROW EXECUTE FUNCTION maia_outbound_private.reject_update();
CREATE FUNCTION public.maia_trial_outbound_publish(p_publisher text,p_mailbox text,p_account text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE old maia_outbound_private.trial_messages%ROWTYPE; summary text; accepted timestamptz;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM maia_outbound_private.publishers WHERE id=p_publisher AND active AND mailbox=p_mailbox AND provider_account=p_account)
 THEN RAISE EXCEPTION 'publisher not authorized'; END IF;
 IF (jsonb_typeof(p_payload)='object' AND (SELECT count(*) FROM jsonb_object_keys(p_payload))=10
 AND p_payload ?& ARRAY['snapshot_id','provider_email_id','rfc_message_id','recipient','stage','accepted_at','content_digest','rfc_source','offer_present','offer_summary']
 AND jsonb_typeof(p_payload->'snapshot_id')='string' AND length(p_payload->>'snapshot_id') BETWEEN 1 AND 100
 AND jsonb_typeof(p_payload->'provider_email_id')='string' AND p_payload->>'provider_email_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 AND jsonb_typeof(p_payload->'rfc_message_id')='string' AND length(p_payload->>'rfc_message_id') BETWEEN 5 AND 998
 AND p_payload->>'rfc_message_id' ~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$'
 AND jsonb_typeof(p_payload->'recipient')='string' AND length(p_payload->>'recipient') BETWEEN 3 AND 254
 AND p_payload->>'recipient' ~ '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
 AND length(split_part(p_payload->>'recipient','@',1))<=64
 AND jsonb_typeof(p_payload->'stage')='string' AND p_payload->>'stage' IN ('inicio','meio','ultimo-dia','encerrado','recuperacao','ultima-chance')
 AND jsonb_typeof(p_payload->'accepted_at')='string' AND p_payload->>'accepted_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 AND jsonb_typeof(p_payload->'content_digest')='string' AND p_payload->>'content_digest' ~ '^[0-9a-f]{64}$'
 AND (p_payload->'offer_summary'='null'::jsonb OR (p_payload->'offer_present'='true'::jsonb AND jsonb_typeof(p_payload->'offer_summary')='string' AND length(p_payload->>'offer_summary')<=160 AND p_payload->>'offer_summary' ~ '^(?:[0-9]{1,3}(?:,[0-9]{1,2})?%|R\$ [0-9.]{1,12}(?:,[0-9]{2})?) de desconto (?:na primeira cobrança|no primeiro mês|nos [1-9][0-9]{0,2} primeiros meses|em todas as mensalidades)$'))
 AND jsonb_typeof(p_payload->'offer_present')='boolean' AND p_payload->>'rfc_source'='resend-retrieve-v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid publication'; END IF;
 accepted:=(p_payload->>'accepted_at')::timestamptz;
 IF accepted>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid acceptance time'; END IF;
 summary:='Registro histórico: e-mail de acompanhamento do teste Barberias, etapa '||(p_payload->>'stage')||'. A mensagem convidava a continuar a configuração ou consultar planos. Não comprova o estado atual da conta nem a validade atual de qualquer oferta.';
 -- Serialize the publisher's small namespace so exact concurrent retries have one outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended('outbound:'||p_publisher,0));
 IF EXISTS(SELECT 1 FROM maia_outbound_private.erased_snapshots WHERE publisher_id=p_publisher AND snapshot_id=p_payload->>'snapshot_id') THEN RAISE EXCEPTION 'outbound evidence erased'; END IF;
 SELECT * INTO old FROM maia_outbound_private.trial_messages WHERE publisher_id=p_publisher AND snapshot_id=p_payload->>'snapshot_id';
 IF FOUND THEN
  IF old.provider_email_id IS DISTINCT FROM (p_payload->>'provider_email_id')::uuid OR old.rfc_message_id IS DISTINCT FROM p_payload->>'rfc_message_id'
   OR old.recipient IS DISTINCT FROM p_payload->>'recipient' OR old.stage IS DISTINCT FROM p_payload->>'stage'
   OR old.offer_summary IS DISTINCT FROM p_payload->>'offer_summary' OR old.offer_present IS DISTINCT FROM (p_payload->>'offer_present')::boolean OR old.accepted_at IS DISTINCT FROM accepted OR old.content_digest IS DISTINCT FROM p_payload->>'content_digest' OR old.rfc_source IS DISTINCT FROM p_payload->>'rfc_source'
  THEN RAISE EXCEPTION 'immutable publication conflict'; END IF;
  RETURN jsonb_build_object('version',1,'status','stored');
 END IF;
 INSERT INTO maia_outbound_private.trial_messages VALUES(p_publisher,p_payload->>'snapshot_id',(p_payload->>'provider_email_id')::uuid,p_payload->>'rfc_message_id',p_payload->>'recipient',p_payload->>'stage',accepted,p_payload->>'content_digest',p_payload->>'rfc_source',summary,(p_payload->>'offer_present')::boolean,p_payload->>'offer_summary');
 RETURN jsonb_build_object('version',1,'status','stored');
END $$;
CREATE FUNCTION public.maia_trial_outbound_context(p_sender text,p_mailbox text,p_thread text,p_event text,p_rfc text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE tenant constant uuid:='0af00833-c1f7-42f4-9543-a5e0ff6f55fc'; cid uuid; matches bigint; result jsonb;
BEGIN
 IF p_sender IS NULL OR p_mailbox IS NULL OR p_thread IS NULL OR p_event IS NULL OR p_rfc IS NULL
  OR length(p_thread) NOT BETWEEN 1 AND 512 OR length(p_event) NOT BETWEEN 1 AND 512
  OR p_thread ~ '[[:cntrl:]]' OR p_event ~ '[[:cntrl:]]' OR p_thread<>btrim(p_thread) OR p_event<>btrim(p_event)
  OR length(p_rfc) NOT BETWEEN 5 AND 998 OR p_rfc !~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$'
 THEN RETURN jsonb_build_object('version',1,'status','unavailable'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT e.contact_id INTO cid FROM maia_intake_private.events e
 JOIN maia_intake_private.identities i ON i.user_id=e.user_id AND i.channel=e.channel AND i.subject=e.subject AND i.contact_id=e.contact_id
 JOIN public.contacts c ON c.id=i.contact_id
 WHERE e.user_id=tenant AND e.channel='email' AND e.scope=p_mailbox AND e.event_id=p_event AND e.subject=p_sender AND e.pending_id IS NULL
 AND c.user_id=tenant AND lower(c.email)=p_sender FOR SHARE OF c;
 -- No thread row required: this lookup precedes first interaction. Existing conflicts deny.
 IF cid IS NULL OR EXISTS(SELECT 1 FROM maia_intake_private.threads WHERE user_id=tenant AND mailbox=p_mailbox AND thread_id=p_thread AND subject<>p_sender)
 OR EXISTS(SELECT 1 FROM maia_intake_private.interactions WHERE user_id=tenant AND mailbox=p_mailbox AND event_id=p_event AND thread_id<>p_thread)
 THEN RETURN jsonb_build_object('version',1,'status','unavailable'); END IF;
 SELECT count(*),jsonb_agg(jsonb_build_object('product','barberias','stage',m.stage,'approved_summary',m.approved_summary,
  'accepted_at',to_char(m.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'historical_offer_present',m.offer_present,'historical_offer_summary',m.offer_summary,'delivery_status','not_verified','offer_validity','not_revalidated','public_next_step',NULL)) INTO matches,result
 FROM maia_outbound_private.trial_messages m JOIN maia_outbound_private.publishers p ON p.id=m.publisher_id
 WHERE p.active AND p.mailbox=p_mailbox AND m.recipient=p_sender AND m.rfc_message_id=p_rfc;
 IF matches=0 THEN RETURN jsonb_build_object('version',1,'status','unavailable'); END IF;
 IF matches<>1 THEN RETURN jsonb_build_object('version',1,'status','ambiguous'); END IF;
 RETURN jsonb_build_object('version',1,'status','found','outbound',result->0);
END $$;
REVOKE ALL ON FUNCTION public.maia_trial_outbound_publish(text,text,text,jsonb),public.maia_trial_outbound_context(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_trial_outbound_publish(text,text,text,jsonb),public.maia_trial_outbound_context(text,text,text,text,text) TO service_role;
CREATE FUNCTION public.maia_trial_outbound_erase(p_publisher text,p_mailbox text,p_account text,p_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
 IF p_snapshot IS NULL OR length(p_snapshot) NOT BETWEEN 1 AND 100 OR p_snapshot<>btrim(p_snapshot) OR p_snapshot ~ '[[:cntrl:]]'
 -- active revokes publication/lookup only. This RPC still requires EXECUTE and
 -- the authenticated bridge's exact immutable publisher/mailbox/account binding.
 -- Revoking that credential blocks this path too; owner cleanup must call this
 -- exact scoped RPC administratively, never reactivate publication to erase.
 OR NOT EXISTS(SELECT 1 FROM maia_outbound_private.publishers WHERE id=p_publisher AND mailbox=p_mailbox AND provider_account=p_account)
 THEN RAISE EXCEPTION 'erasure not authorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('outbound:'||p_publisher,0));
 INSERT INTO maia_outbound_private.erased_snapshots(publisher_id,snapshot_id) VALUES(p_publisher,p_snapshot) ON CONFLICT DO NOTHING;
 DELETE FROM maia_outbound_private.trial_messages WHERE publisher_id=p_publisher AND snapshot_id=p_snapshot;
 RETURN jsonb_build_object('version',1,'status','erased');
END $$;
REVOKE ALL ON FUNCTION public.maia_trial_outbound_erase(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maia_trial_outbound_erase(text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;