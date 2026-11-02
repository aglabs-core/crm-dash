-- Text-only second step. Dormant: same private off-by-default control as initial.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.email_campaign_batches
 ADD COLUMN second_approval jsonb;
ALTER TABLE public.email_campaign_batch_recipients
 ADD COLUMN second_parent uuid REFERENCES public.email_messages(id) ON DELETE RESTRICT,
 ADD COLUMN second_message jsonb;
ALTER TABLE crm_campaign_private.dispatch_outbox DROP CONSTRAINT dispatch_outbox_step_check;
ALTER TABLE crm_campaign_private.dispatch_outbox ADD CHECK(step IN('initial','second'));
ALTER TABLE crm_campaign_private.dispatch_outbox
 ADD COLUMN parent_message_id uuid REFERENCES public.email_messages(id) ON DELETE RESTRICT,
 ADD COLUMN immutable_content jsonb,
 ADD COLUMN ledger_message_id uuid REFERENCES public.email_messages(id) ON DELETE RESTRICT;
ALTER TABLE crm_campaign_private.dispatch_outbox ADD CHECK(step<>'second' OR (parent_message_id IS NOT NULL AND immutable_content IS NOT NULL));

CREATE FUNCTION public.approve_campaign_second_step(p_batch uuid,p_subject text,p_message text,p_wait_seconds integer,p_key uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.email_campaign_batches; i public.email_campaign_batch_recipients; m public.email_messages; review jsonb; approval jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_key IS NULL OR p_wait_seconds IS NULL OR p_wait_seconds NOT BETWEEN 1 AND 31536000 OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 20000 OR p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 300 OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1000 THEN RAISE EXCEPTION 'Explicit second content, interval and approval required'; END IF;
 SELECT * INTO STRICT b FROM public.email_campaign_batches WHERE id=p_batch AND user_id=auth.uid() FOR UPDATE;
 approval:=jsonb_build_object('step','second','subject',p_subject,'text',p_message,'wait_seconds',p_wait_seconds,'key',p_key,'note',p_note);
 IF b.second_approval IS NOT NULL THEN
   IF b.second_approval=approval THEN RETURN jsonb_build_object('status','approved','batch_id',b.id); END IF;
   RAISE EXCEPTION 'Second approval immutable';
 END IF;
 IF b.state<>'approved' THEN RAISE EXCEPTION 'Batch not approved'; END IF;
 review:=public.review_email_campaign_followup(b.campaign_id,1);
 FOR i IN SELECT * FROM public.email_campaign_batch_recipients WHERE batch_id=b.id AND user_id=auth.uid() ORDER BY id FOR UPDATE LOOP
   -- Revalidate the current recipient/contact, never just copy an old audience.
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(review->'recipients') x WHERE x->>'recipient_id'=i.recipient_id::text AND x->'reasons'='[]'::jsonb)
     OR crm_campaign_private.recipient_reason(auth.uid(),i.recipient_id,b.product,i.email) IS NOT NULL THEN RAISE EXCEPTION 'Second audience unavailable'; END IF;
   SELECT x.* INTO STRICT m FROM public.email_messages x JOIN public.email_campaign_recipients r ON r.id=i.recipient_id AND r.user_id=auth.uid()
     WHERE x.user_id=crm_ledger_private.tenant() AND x.contact_id=r.contact_id AND x.campaign_id=b.campaign_id AND x.recipient_id=r.id AND x.address=i.email
     AND x.direction='outbound' AND x.category='prospeccao' AND public.campaign_product_key(x.product)=public.campaign_product_key(b.product)
     ORDER BY x.sent_at,x.id LIMIT 1;
   IF m.delivered_at IS NULL OR m.status IN('soft_bounced','bounced','failed','deferred','complained','unsubscribed') OR m.delivered_at+make_interval(secs=>p_wait_seconds)>now() OR replace(replace(p_message,'{{nome}}',i.name),'{{produto}}',b.product) IS NOT DISTINCT FROM m.body_text THEN RAISE EXCEPTION 'Delivered initial and explicit wait required'; END IF;
   UPDATE public.email_campaign_batch_recipients SET second_parent=m.id,second_message=jsonb_build_object('from',b.sender_email,'to',i.email,'replyTo',b.reply_to,'subject',replace(replace(p_subject,'{{nome}}',i.name),'{{produto}}',b.product),'text',replace(replace(p_message,'{{nome}}',i.name),'{{produto}}',b.product)) WHERE id=i.id;
 END LOOP;
 IF NOT FOUND THEN RAISE EXCEPTION 'Empty audience'; END IF;
 UPDATE public.email_campaign_batches SET second_approval=approval WHERE id=b.id;
 RETURN jsonb_build_object('status','approved','batch_id',b.id);
END $$;

CREATE FUNCTION crm_campaign_private.second_reason(p_item uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.email_campaign_batches; i public.email_campaign_batch_recipients; m public.email_messages; r public.email_campaign_recipients; review jsonb;
BEGIN
 SELECT * INTO i FROM public.email_campaign_batch_recipients WHERE id=p_item AND user_id=auth.uid();
 IF NOT FOUND THEN RETURN 'owner'; END IF;
 SELECT * INTO b FROM public.email_campaign_batches WHERE id=i.batch_id AND user_id=auth.uid();
 IF b.state IS DISTINCT FROM 'approved' OR b.second_approval IS NULL THEN RETURN 'second_unapproved'; END IF;
 SELECT * INTO r FROM public.email_campaign_recipients WHERE id=i.recipient_id AND user_id=auth.uid() AND campaign_id=b.campaign_id;
 IF NOT FOUND OR lower(btrim(r.email_snapshot)) IS DISTINCT FROM i.email OR crm_campaign_private.recipient_reason(auth.uid(),r.id,b.product,i.email) IS NOT NULL THEN RETURN 'ineligible'; END IF;
 SELECT * INTO m FROM public.email_messages WHERE id=i.second_parent AND user_id=crm_ledger_private.tenant() AND contact_id=r.contact_id AND campaign_id=b.campaign_id AND recipient_id=r.id AND address=i.email AND direction='outbound' AND category='prospeccao' AND public.campaign_product_key(product)=public.campaign_product_key(b.product);
 IF NOT FOUND OR m.delivered_at IS NULL OR i.second_message IS NULL OR m.delivered_at+make_interval(secs=>(b.second_approval->>'wait_seconds')::integer)>now() THEN RETURN 'parent_or_wait'; END IF;
 IF EXISTS(SELECT 1 FROM public.email_messages x WHERE x.user_id=crm_ledger_private.tenant() AND (x.contact_id=r.contact_id OR x.address=i.email) AND (x.direction='inbound' OR x.replied_at IS NOT NULL OR x.status IN('soft_bounced','bounced','failed','deferred','complained','unsubscribed'))) THEN RETURN 'history_stop'; END IF;
 review:=public.review_email_campaign_followup(b.campaign_id,1);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(review->'recipients') x WHERE x->>'recipient_id'=r.id::text AND x->'reasons'='[]'::jsonb) THEN RETURN 'ineligible'; END IF;
 IF EXISTS(SELECT 1 FROM crm_campaign_private.dispatch_outbox o WHERE o.item_id=i.id AND o.step='second' AND (o.contact_id IS DISTINCT FROM r.contact_id OR o.address IS DISTINCT FROM i.email OR o.product IS DISTINCT FROM public.campaign_product_key(b.product) OR o.parent_message_id IS DISTINCT FROM m.id OR o.immutable_content IS DISTINCT FROM i.second_message)) THEN RETURN 'binding_changed'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.claim_campaign_second_dispatch(p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.email_campaign_batch_recipients; b public.email_campaign_batches; r public.email_campaign_recipients; o crm_campaign_private.dispatch_outbox; reason text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT (SELECT enabled FROM crm_campaign_private.dispatch_control WHERE singleton FOR SHARE) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 SELECT * INTO STRICT i FROM public.email_campaign_batch_recipients WHERE id=p_item AND user_id=auth.uid();
 SELECT * INTO STRICT b FROM public.email_campaign_batches WHERE id=i.batch_id AND user_id=auth.uid() FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO o FROM crm_campaign_private.dispatch_outbox WHERE item_id=p_item AND step='second' FOR UPDATE;
 IF FOUND THEN
   IF o.state='dispatch_started' AND o.lease_until<=now() THEN UPDATE crm_campaign_private.dispatch_outbox SET state='uncertain',updated_at=now() WHERE id=o.id; RETURN jsonb_build_object('status','uncertain'); END IF;
   IF o.state IN('accepted','uncertain','review','dispatch_started') THEN RETURN jsonb_build_object('status',o.state,'id',o.id); END IF;
   IF o.state='claimed' AND o.lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
 END IF;
 reason:=crm_campaign_private.second_reason(p_item);
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('status',reason); END IF;
 SELECT * INTO STRICT r FROM public.email_campaign_recipients WHERE id=i.recipient_id AND user_id=auth.uid();
 IF o.id IS NULL THEN
 INSERT INTO crm_campaign_private.dispatch_outbox(user_id,item_id,batch_id,contact_id,product,address,step,state,lease_until,parent_message_id,immutable_content)
 VALUES(auth.uid(),i.id,b.id,r.contact_id,public.campaign_product_key(b.product),i.email,'second','claimed',now()+interval '60 seconds',i.second_parent,i.second_message) ON CONFLICT DO NOTHING RETURNING * INTO o;
 IF o.id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 ELSE UPDATE crm_campaign_private.dispatch_outbox SET state='claimed',token=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=o.id RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('status','claimed','id',o.id,'token',o.token);
END $$;

ALTER FUNCTION public.start_campaign_dispatch(uuid,uuid) RENAME TO start_campaign_initial_dispatch;
REVOKE ALL ON FUNCTION public.start_campaign_initial_dispatch(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.start_campaign_dispatch(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o crm_campaign_private.dispatch_outbox; b public.email_campaign_batches; reason text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT (SELECT enabled FROM crm_campaign_private.dispatch_control WHERE singleton FOR SHARE) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 SELECT b0.* INTO b FROM public.email_campaign_batches b0 JOIN crm_campaign_private.dispatch_outbox d ON d.batch_id=b0.id WHERE d.id=p_id AND d.user_id=auth.uid() FOR SHARE OF b0;
 SELECT * INTO STRICT o FROM crm_campaign_private.dispatch_outbox WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF o.step='initial' THEN RETURN public.start_campaign_initial_dispatch(p_id,p_token); END IF;
 IF o.state<>'claimed' OR o.token IS DISTINCT FROM p_token OR o.lease_until<=now() THEN RETURN jsonb_build_object('status','fenced'); END IF;
 reason:=crm_campaign_private.second_reason(o.item_id);
 IF reason IS NOT NULL THEN UPDATE crm_campaign_private.dispatch_outbox SET state='review',receipt=jsonb_build_object('reason',reason),updated_at=now() WHERE id=o.id; RETURN jsonb_build_object('status','review'); END IF;
 UPDATE crm_campaign_private.dispatch_outbox SET state='dispatch_started',dispatch_started_at=now(),lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=o.id;
 RETURN jsonb_build_object('status','dispatch_started','id',o.id,'token',o.token,'message',o.immutable_content);
END $$;

CREATE FUNCTION crm_campaign_private.freeze_second() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='email_campaign_batches' THEN
   IF OLD.second_approval IS NOT NULL AND NEW.second_approval IS DISTINCT FROM OLD.second_approval THEN RAISE EXCEPTION 'Immutable second approval'; END IF;
 ELSE
   IF OLD.second_message IS NOT NULL AND (NEW.second_message IS DISTINCT FROM OLD.second_message OR NEW.second_parent IS DISTINCT FROM OLD.second_parent) THEN RAISE EXCEPTION 'Immutable second message'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_second_approval BEFORE UPDATE ON public.email_campaign_batches FOR EACH ROW EXECUTE FUNCTION crm_campaign_private.freeze_second();
CREATE TRIGGER freeze_second_message BEFORE UPDATE ON public.email_campaign_batch_recipients FOR EACH ROW EXECUTE FUNCTION crm_campaign_private.freeze_second();
-- Independently retryable bookkeeping: never calls a provider, even when disabled.
CREATE FUNCTION public.publish_campaign_second_dispatch(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o crm_campaign_private.dispatch_outbox; b public.email_campaign_batches; i public.email_campaign_batch_recipients; result jsonb; m public.email_messages;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO STRICT o FROM crm_campaign_private.dispatch_outbox WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF o.step<>'second' OR o.state<>'accepted' THEN RETURN jsonb_build_object('status','not_accepted'); END IF;
 SELECT * INTO STRICT b FROM public.email_campaign_batches WHERE id=o.batch_id AND user_id=auth.uid();
 SELECT * INTO STRICT i FROM public.email_campaign_batch_recipients WHERE id=o.item_id AND batch_id=b.id AND user_id=auth.uid();
 IF o.parent_message_id IS DISTINCT FROM i.second_parent OR o.immutable_content IS DISTINCT FROM i.second_message THEN RAISE EXCEPTION 'Immutable publication binding changed'; END IF;
 result:=public.crm_record_outbound_email(jsonb_build_object('provider','brevo','provider_message_id',o.receipt->>'provider_message_id','category','prospeccao','source_key','crm.campaign.second','product',o.product,'contact_id',o.contact_id,'campaign_id',b.campaign_id,'recipient_id',i.recipient_id,'address',o.address,'from_address',o.immutable_content->>'from','reply_to',o.immutable_content->>'replyTo','subject',o.immutable_content->>'subject','body_text',o.immutable_content->>'text','sent_at',o.dispatch_started_at,'status','accepted'));
 SELECT * INTO STRICT m FROM public.email_messages WHERE id=(result->>'message_id')::uuid AND user_id=crm_ledger_private.tenant();
 IF m.contact_id IS DISTINCT FROM o.contact_id OR m.campaign_id IS DISTINCT FROM b.campaign_id OR m.recipient_id IS DISTINCT FROM i.recipient_id OR m.product IS DISTINCT FROM o.product OR m.body_text IS DISTINCT FROM o.immutable_content->>'text' OR m.subject IS DISTINCT FROM o.immutable_content->>'subject' OR m.from_address IS DISTINCT FROM o.immutable_content->>'from' OR m.reply_to IS DISTINCT FROM o.immutable_content->>'replyTo' OR m.source_key IS DISTINCT FROM 'crm.campaign.second' OR m.sent_at IS DISTINCT FROM o.dispatch_started_at OR (m.in_reply_to_message_id IS NOT NULL AND m.in_reply_to_message_id IS DISTINCT FROM o.parent_message_id) THEN RAISE EXCEPTION 'Ledger immutable receipt conflict'; END IF;
 UPDATE public.email_messages SET in_reply_to_message_id=o.parent_message_id WHERE id=m.id;
 UPDATE crm_campaign_private.dispatch_outbox SET ledger_message_id=m.id WHERE id=o.id;
 RETURN jsonb_build_object('status','published','id',o.id,'message_id',m.id);
END $$;
REVOKE ALL ON FUNCTION public.publish_campaign_second_dispatch(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.publish_campaign_second_dispatch(uuid) TO authenticated;
CREATE FUNCTION public.list_campaign_second_work(p_mode text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_mode IS NULL OR p_mode NOT IN('send','reconcile') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Explicit bounded work request required'; END IF;
 IF p_mode='reconcile' THEN
 RETURN (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT o.id FROM crm_campaign_private.dispatch_outbox o WHERE o.user_id=auth.uid() AND o.step='second' AND o.state='accepted' AND o.ledger_message_id IS NULL ORDER BY o.created_at,o.id LIMIT p_limit) x);
 END IF;
 IF NOT (SELECT enabled FROM crm_campaign_private.dispatch_control WHERE singleton) THEN RETURN '[]'::jsonb; END IF;
 RETURN (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT i.id AS item_id FROM public.email_campaign_batch_recipients i JOIN public.email_campaign_batches b ON b.id=i.batch_id AND b.user_id=auth.uid()
 WHERE i.user_id=auth.uid() AND b.state='approved' AND b.second_approval IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM crm_campaign_private.dispatch_outbox o WHERE o.user_id=auth.uid() AND o.step='second' AND (o.item_id=i.id OR (o.product=public.campaign_product_key(b.product) AND o.address=i.email)) AND (o.state IN('accepted','review','uncertain','dispatch_started') OR (o.state='claimed' AND o.lease_until>now())))
 AND crm_campaign_private.second_reason(i.id) IS NULL ORDER BY b.approved_at,i.id LIMIT p_limit) x);
END $$;
REVOKE ALL ON FUNCTION public.list_campaign_second_work(text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_campaign_second_work(text,integer) TO authenticated;
REVOKE ALL ON FUNCTION crm_campaign_private.second_reason(uuid),crm_campaign_private.freeze_second() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.approve_campaign_second_step(uuid,text,text,integer,uuid,text),public.claim_campaign_second_dispatch(uuid),public.start_campaign_dispatch(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approve_campaign_second_step(uuid,text,text,integer,uuid,text),public.claim_campaign_second_dispatch(uuid),public.start_campaign_dispatch(uuid,uuid) TO authenticated;
COMMIT;
