-- Dormant single-send vertical. No caller, schedule, production provider or activation.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE crm_campaign_private.dispatch_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  wait_seconds integer CHECK(wait_seconds BETWEEN 1 AND 31536000)
);
INSERT INTO crm_campaign_private.dispatch_control(singleton) VALUES(true);
CREATE TABLE crm_campaign_private.dispatch_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.email_campaign_batch_recipients(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.email_campaign_batches(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  product text NOT NULL,
  address text NOT NULL,
  step text NOT NULL CHECK(step='initial'),
  state text NOT NULL CHECK(state IN ('claimed','ready','dispatch_started','accepted','uncertain','review')),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_until timestamptz NOT NULL,
  dispatch_started_at timestamptz,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,step),
  UNIQUE(user_id,product,address,step),
  UNIQUE(user_id,product,contact_id,step),
  CHECK((state NOT IN ('dispatch_started','accepted','uncertain')) OR dispatch_started_at IS NOT NULL),
  CHECK((state<>'accepted') OR (jsonb_typeof(receipt)='object' AND jsonb_typeof(receipt->'provider_message_id')='string' AND length(receipt->>'provider_message_id') BETWEEN 1 AND 500) IS TRUE)
);
CREATE UNIQUE INDEX dispatch_provider_receipt ON crm_campaign_private.dispatch_outbox((receipt->>'provider_message_id')) WHERE state='accepted';
ALTER TABLE crm_campaign_private.dispatch_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_campaign_private.dispatch_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_campaign_private.dispatch_control,crm_campaign_private.dispatch_outbox FROM PUBLIC,anon,authenticated,service_role;

-- Every admission and start checks the current authenticated campaign owner.
-- Current address/contact/campaign relation, not universal ledger owner equality.
CREATE FUNCTION crm_campaign_private.dispatch_reason(p_item uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.email_campaign_batch_recipients; b public.email_campaign_batches; r public.email_campaign_recipients; c public.contacts; wait_for integer;
BEGIN
 SELECT * INTO i FROM public.email_campaign_batch_recipients WHERE id=p_item AND user_id=auth.uid();
 IF NOT FOUND THEN RETURN 'owner'; END IF;
 SELECT * INTO b FROM public.email_campaign_batches WHERE id=i.batch_id AND user_id=auth.uid();
 IF NOT FOUND OR b.state<>'approved' THEN RETURN 'approval_revoked'; END IF;
 SELECT wait_seconds INTO wait_for FROM crm_campaign_private.dispatch_control WHERE singleton;
 IF wait_for IS NULL THEN RETURN 'unconfigured'; END IF;
 IF b.approved_at+make_interval(secs=>wait_for)>now() THEN RETURN 'interval'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.email_campaigns x WHERE x.id=b.campaign_id AND x.user_id=auth.uid() AND x.provider='brevo' AND x.status='draft') THEN RETURN 'campaign_changed'; END IF;
 SELECT * INTO r FROM public.email_campaign_recipients WHERE id=i.recipient_id AND user_id=auth.uid() AND campaign_id=b.campaign_id;
 IF NOT FOUND OR lower(btrim(r.email_snapshot)) IS DISTINCT FROM i.email THEN RETURN 'recipient_changed'; END IF;
 SELECT * INTO c FROM public.contacts WHERE id=r.contact_id AND user_id=auth.uid();
 IF NOT FOUND THEN RETURN 'contact_changed'; END IF;
 IF EXISTS(SELECT 1 FROM crm_campaign_private.dispatch_outbox o WHERE o.item_id=p_item
   AND (o.contact_id IS DISTINCT FROM c.id OR o.batch_id IS DISTINCT FROM i.batch_id
     OR o.address IS DISTINCT FROM i.email OR o.product IS DISTINCT FROM public.campaign_product_key(b.product))) THEN RETURN 'binding_changed'; END IF;
 IF crm_campaign_private.recipient_reason(auth.uid(),r.id,b.product,i.email) IS NOT NULL THEN RETURN 'ineligible'; END IF;
 IF c.account_status IS NOT NULL OR c.account_ref IS NOT NULL THEN RETURN 'account'; END IF;
 IF NOT c.prospecting_pool OR c.status IS DISTINCT FROM 'Arquivado' THEN RETURN 'not_cold'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.contact_id=c.id AND p.user_id IN(c.user_id,crm_ledger_private.tenant()) AND public.campaign_product_key(p.product)=public.campaign_product_key(b.product) AND p.status IN('paid','partially_refunded') AND p.net_amount>0) THEN RETURN 'payment'; END IF;
 IF r.provider_message_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.email_campaign_events e WHERE e.recipient_id=r.id) THEN RETURN 'prior_campaign_effect'; END IF;
 IF EXISTS(SELECT 1 FROM public.email_messages m WHERE m.user_id=crm_ledger_private.tenant() AND (m.contact_id=c.id OR m.address=i.email)
   AND (m.direction='inbound' OR m.replied_at IS NOT NULL OR m.status IN('complained','unsubscribed','bounced') OR (m.direction='outbound' AND m.category='prospeccao'))) THEN RETURN 'history'; END IF;
 IF EXISTS(SELECT 1 FROM public.email_campaign_recipients d WHERE d.campaign_id=b.campaign_id AND d.id<>r.id AND lower(btrim(d.email_snapshot))=i.email) THEN RETURN 'duplicate'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION crm_campaign_private.dispatch_reason(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_campaign_dispatch(p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.email_campaign_batch_recipients; b public.email_campaign_batches; r public.email_campaign_recipients; o crm_campaign_private.dispatch_outbox; reason text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 -- Lock control through admission; off prevents durable new claims.
 IF NOT (SELECT enabled FROM crm_campaign_private.dispatch_control WHERE singleton FOR SHARE) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 SELECT * INTO STRICT i FROM public.email_campaign_batch_recipients WHERE id=p_item AND user_id=auth.uid();
 SELECT * INTO STRICT b FROM public.email_campaign_batches WHERE id=i.batch_id AND user_id=auth.uid() FOR SHARE;
 -- Per owner lock serializes deduplication and competing batches in this small vertical.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO o FROM crm_campaign_private.dispatch_outbox WHERE item_id=p_item AND step='initial' FOR UPDATE;
 IF FOUND THEN
   IF o.state='dispatch_started' AND o.lease_until<=now() THEN
     UPDATE crm_campaign_private.dispatch_outbox SET state='uncertain',updated_at=now() WHERE id=o.id;
     RETURN jsonb_build_object('status','uncertain');
   END IF;
   IF o.state IN('accepted','uncertain','review','dispatch_started') THEN RETURN jsonb_build_object('status',o.state); END IF;
   IF o.state='claimed' AND o.lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
 END IF;
 reason:=crm_campaign_private.dispatch_reason(p_item);
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('status',reason); END IF;
 SELECT * INTO STRICT r FROM public.email_campaign_recipients WHERE id=i.recipient_id;
 IF o.id IS NULL THEN
   INSERT INTO crm_campaign_private.dispatch_outbox(user_id,item_id,batch_id,contact_id,product,address,step,state,lease_until)
   VALUES(auth.uid(),p_item,b.id,r.contact_id,public.campaign_product_key(b.product),i.email,'initial','claimed',now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING * INTO o;
   IF o.id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 ELSE
   UPDATE crm_campaign_private.dispatch_outbox SET state='claimed',token=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=o.id RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('status','claimed','id',o.id,'token',o.token);
END $$;

CREATE FUNCTION public.start_campaign_dispatch(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o crm_campaign_private.dispatch_outbox; i public.email_campaign_batch_recipients; b public.email_campaign_batches; reason text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT (SELECT enabled FROM crm_campaign_private.dispatch_control WHERE singleton FOR SHARE) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 -- Match batch-state lock before outbox lock, as in claim.
 SELECT b0.* INTO b FROM public.email_campaign_batches b0 JOIN crm_campaign_private.dispatch_outbox d ON d.batch_id=b0.id WHERE d.id=p_id AND d.user_id=auth.uid() FOR SHARE OF b0;
 SELECT * INTO STRICT o FROM crm_campaign_private.dispatch_outbox WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF o.state<>'claimed' OR o.token IS DISTINCT FROM p_token OR o.lease_until<=now() THEN RETURN jsonb_build_object('status','fenced'); END IF;
 reason:=crm_campaign_private.dispatch_reason(o.item_id);
 IF reason IS NOT NULL THEN
   UPDATE crm_campaign_private.dispatch_outbox SET state='review',receipt=jsonb_build_object('reason',reason),updated_at=now() WHERE id=o.id;
   RETURN jsonb_build_object('status','review');
 END IF;
 SELECT * INTO STRICT i FROM public.email_campaign_batch_recipients WHERE id=o.item_id;
 UPDATE crm_campaign_private.dispatch_outbox SET state='dispatch_started',dispatch_started_at=now(),lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=o.id;
 RETURN jsonb_build_object('status','dispatch_started','id',o.id,'token',o.token,'message',jsonb_build_object('from',b.sender_email,'to',i.email,'replyTo',b.reply_to,'subject',i.subject,'text',i.content));
END $$;

CREATE FUNCTION public.finish_campaign_dispatch(p_id uuid,p_token uuid,p_provider_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o crm_campaign_private.dispatch_outbox; final_state text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO STRICT o FROM crm_campaign_private.dispatch_outbox WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF o.token IS DISTINCT FROM p_token OR o.state<>'dispatch_started' THEN RETURN jsonb_build_object('status','fenced'); END IF;
 final_state:=CASE WHEN p_provider_id IS NOT NULL AND length(btrim(p_provider_id)) BETWEEN 1 AND 500 AND o.lease_until>now() THEN 'accepted' ELSE 'uncertain' END;
 UPDATE crm_campaign_private.dispatch_outbox SET state=final_state,receipt=jsonb_build_object('provider_message_id',CASE WHEN final_state='accepted' THEN p_provider_id ELSE NULL END),updated_at=now() WHERE id=o.id;
 RETURN jsonb_build_object('status',final_state,'id',o.id);
END $$;

-- Only use before start; absence of an HTTP receipt is NEVER rollback evidence.
CREATE FUNCTION public.release_campaign_dispatch(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 UPDATE crm_campaign_private.dispatch_outbox SET state='ready',updated_at=now() WHERE id=p_id AND user_id=auth.uid() AND token=p_token AND state='claimed';
 RETURN jsonb_build_object('status',CASE WHEN FOUND THEN 'ready' ELSE 'fenced' END);
END $$;
REVOKE ALL ON FUNCTION public.claim_campaign_dispatch(uuid),public.start_campaign_dispatch(uuid,uuid),public.finish_campaign_dispatch(uuid,uuid,text),public.release_campaign_dispatch(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_dispatch(uuid),public.start_campaign_dispatch(uuid,uuid),public.finish_campaign_dispatch(uuid,uuid,text),public.release_campaign_dispatch(uuid,uuid) TO authenticated;
COMMIT;
