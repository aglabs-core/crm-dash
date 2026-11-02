-- Additive historical bridge. No initial approval, outbox, provider or activation.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.email_campaign_batches DROP CONSTRAINT email_campaign_batches_state_check;
ALTER TABLE public.email_campaign_batches ADD CHECK(state IN('draft','approved','paused','cancelled'));
ALTER TABLE public.email_campaign_batches ALTER COLUMN approved_at DROP NOT NULL;
ALTER TABLE public.email_campaign_batches ADD COLUMN batch_kind text NOT NULL DEFAULT 'initial' CHECK(batch_kind IN('initial','legacy_second')),
 ADD COLUMN legacy_review jsonb;
ALTER TABLE public.email_campaign_batch_recipients ADD COLUMN legacy_parent_snapshot jsonb,
 ADD COLUMN second_selected boolean NOT NULL DEFAULT false;
DROP INDEX public.email_campaign_batch_active_idx;
CREATE UNIQUE INDEX email_campaign_batch_active_idx ON public.email_campaign_batches(campaign_id) WHERE state IN('draft','approved','paused');

CREATE FUNCTION crm_campaign_private.legacy_second_policy() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"version":"barberias-prospect-second-v1","waitSeconds":604800,"subject":"Conseguiu conhecer o Barberias?","text":"Oi, {{nome}}. Retomando meu e-mail sobre o Barberias: você pode ver como funciona o agendamento nesta demonstração pública: https://barberias.com.br/b/barber-ag. Para conhecer a gestão e o teste de 7 dias sem cartão: https://barberias.com.br/sobre. Faz sentido para a rotina da sua barbearia? Se não quiser receber outros contatos comerciais, é só responder pedindo para encerrar.","format":"text_only"}'::jsonb
$$;
-- Stable projection of original offer AND delivery evidence, not current campaign copy.
CREATE FUNCTION crm_campaign_private.legacy_parent(p_recipient uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',m.id,'contact_id',m.contact_id,'campaign_id',m.campaign_id,'recipient_id',m.recipient_id,'address',m.address,
 'from',m.from_address,'replyTo',m.reply_to,'subject',m.subject,'text',m.body_text,'provider',m.provider,'provider_message_id',m.provider_message_id,
 'sent_at',m.sent_at,'delivered_at',m.delivered_at)
 FROM public.email_campaign_recipients r JOIN public.contacts c ON c.id=r.contact_id AND c.user_id=r.user_id
 JOIN public.email_messages m ON m.contact_id=r.contact_id AND m.campaign_id=r.campaign_id AND m.recipient_id=r.id
 AND m.user_id=crm_ledger_private.tenant() AND crm_ledger_private.contact_owner(c.user_id)
 AND m.address=lower(btrim(r.email_snapshot)) AND m.direction='outbound' AND m.category='prospeccao'
 JOIN public.email_campaigns campaign ON campaign.id=r.campaign_id AND campaign.user_id=r.user_id
 AND public.campaign_product_key(m.product)=public.campaign_product_key(campaign.product)
 WHERE r.id=p_recipient AND r.user_id=auth.uid() ORDER BY m.sent_at,m.id LIMIT 1
$$;
CREATE FUNCTION public.review_campaign_legacy_second(p_campaign uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.email_campaigns; r record; parent jsonb; row_reasons jsonb; audience jsonb:='[]'; snapshot jsonb; base jsonb; policy jsonb:=crm_campaign_private.legacy_second_policy();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO STRICT c FROM public.email_campaigns WHERE id=p_campaign AND user_id=auth.uid();
 IF c.provider<>'brevo' OR public.campaign_product_key(c.product)<>'barberias' THEN RAISE EXCEPTION 'Barberias Brevo operation only'; END IF;
 base:=public.review_email_campaign_followup(c.id,1);
 FOR r IN SELECT cr.*,coalesce(nullif(btrim(ct.name),''),'você') AS name,ct.prospecting_pool FROM public.email_campaign_recipients cr LEFT JOIN public.contacts ct ON ct.id=cr.contact_id AND ct.user_id=auth.uid() WHERE cr.campaign_id=c.id AND cr.user_id=auth.uid() ORDER BY cr.id LOOP
  parent:=crm_campaign_private.legacy_parent(r.id);
  SELECT x->'reasons' INTO row_reasons FROM jsonb_array_elements(base->'recipients') x WHERE x->>'recipient_id'=r.id::text;
  row_reasons:=coalesce(row_reasons,'["missing_review"]');
  IF parent IS NULL OR parent->>'delivered_at' IS NULL THEN row_reasons:=row_reasons||'"missing_delivery"'::jsonb;
  ELSIF (parent->>'delivered_at')::timestamptz+interval '604800 seconds'>now() THEN row_reasons:=row_reasons||'"delivery_wait_604800"'::jsonb; END IF;
  IF r.prospecting_pool IS DISTINCT FROM true THEN row_reasons:=row_reasons||'"not_cold"'::jsonb; END IF;
  IF crm_campaign_private.recipient_reason(auth.uid(),r.id,c.product,lower(btrim(r.email_snapshot))) IS NOT NULL THEN row_reasons:=row_reasons||'"binding_or_suppression"'::jsonb; END IF;
  IF nullif(btrim(parent->>'text'),'') IS NULL OR nullif(btrim(parent->>'subject'),'') IS NULL OR nullif(btrim(parent->>'from'),'') IS NULL OR nullif(btrim(parent->>'provider_message_id'),'') IS NULL THEN row_reasons:=row_reasons||'"missing_original_snapshot"'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.email_messages m WHERE m.user_id=crm_ledger_private.tenant() AND (m.contact_id=r.contact_id OR m.address=lower(btrim(r.email_snapshot))) AND (m.direction='inbound' OR m.replied_at IS NOT NULL OR m.status IN('failed','soft_bounced','bounced','deferred','complained','unsubscribed'))) THEN row_reasons:=row_reasons||'"history_stop"'::jsonb; END IF;
  IF parent->>'text' IS NOT DISTINCT FROM replace(policy->>'text','{{nome}}',r.name) THEN row_reasons:=row_reasons||'"repeated_initial_text"'::jsonb; END IF;
  audience:=audience||jsonb_build_array(jsonb_build_object('recipient_id',r.id,'contact_id',r.contact_id,'email',lower(btrim(r.email_snapshot)),'name',r.name,'review_note',r.review_note,'parent',parent,'reasons',row_reasons,
   'message',jsonb_build_object('from',parent->>'from','to',lower(btrim(r.email_snapshot)),'replyTo',parent->>'replyTo','subject',policy->>'subject','text',replace(policy->>'text','{{nome}}',r.name))));
 END LOOP;
 IF jsonb_array_length(audience) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Review 1 to 200 historical recipients'; END IF;
 snapshot:=jsonb_build_object('campaign_id',c.id,'policy',policy,'recipients',audience);
 RETURN snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION public.prepare_campaign_legacy_second(p_campaign uuid,p_fingerprint text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.email_campaign_batches; review jsonb; row jsonb; bid uuid; first_parent jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 PERFORM id FROM public.email_campaigns WHERE id=p_campaign AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign unavailable'; END IF;
 SELECT * INTO b FROM public.email_campaign_batches WHERE campaign_id=p_campaign AND user_id=auth.uid() AND state<>'cancelled';
 IF FOUND THEN
  IF b.batch_kind='legacy_second' AND b.fingerprint=p_fingerprint THEN RETURN jsonb_build_object('batch_id',b.id,'status',b.state); END IF;
  RAISE EXCEPTION 'Existing batch or fingerprint conflict';
 END IF;
 review:=public.review_campaign_legacy_second(p_campaign);
 IF review->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Stale review'; END IF;
 SELECT x->'parent' INTO first_parent FROM jsonb_array_elements(review->'recipients') x WHERE x->'parent' IS NOT NULL AND x->'parent'<>'null'::jsonb LIMIT 1;
 IF first_parent IS NULL THEN RAISE EXCEPTION 'No original ledger parent'; END IF;
 INSERT INTO public.email_campaign_batches(campaign_id,user_id,approval_key,fingerprint,state,sender_email,subject,content_text,reply_to,product,approval_note,approved_at,batch_kind,legacy_review)
 VALUES(p_campaign,auth.uid(),gen_random_uuid(),p_fingerprint,'draft',coalesce(first_parent->>'from',''),first_parent->>'subject',coalesce(first_parent->>'text',''),first_parent->>'replyTo','barberias','Historical import only; no initial approval',NULL,'legacy_second',review) RETURNING id INTO bid;
 FOR row IN SELECT * FROM jsonb_array_elements(review->'recipients') LOOP
 INSERT INTO public.email_campaign_batch_recipients(batch_id,user_id,recipient_id,email,name,subject,content,review_note,second_parent,second_message,legacy_parent_snapshot)
 VALUES(bid,auth.uid(),(row->>'recipient_id')::uuid,row->>'email',row->>'name',coalesce(row->'parent'->>'subject',''),coalesce(row->'parent'->>'text',''),row->>'review_note',(row->'parent'->>'id')::uuid,row->'message',row->'parent');
 END LOOP;
 RETURN jsonb_build_object('batch_id',bid,'status','draft');
END $$;
CREATE FUNCTION public.approve_campaign_legacy_second(p_batch uuid,p_fingerprint text,p_recipients jsonb,p_key uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.email_campaign_batches; review jsonb; approval jsonb; row jsonb; n integer;
BEGIN
 IF auth.uid() IS NULL OR p_key IS NULL OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1000 OR jsonb_typeof(p_recipients) IS DISTINCT FROM 'array' OR jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Explicit owner recipient review required'; END IF;
 SELECT * INTO STRICT b FROM public.email_campaign_batches WHERE id=p_batch AND user_id=auth.uid() AND batch_kind='legacy_second' FOR UPDATE;
 approval:=b.legacy_review->'policy'||jsonb_build_object('step','second','wait_seconds',604800,'key',p_key,'note',p_note,'recipient_ids',p_recipients,'fingerprint',p_fingerprint);
 IF b.second_approval IS NOT NULL THEN
  IF b.second_approval=approval THEN RETURN jsonb_build_object('status','approved','batch_id',b.id); END IF;
  RAISE EXCEPTION 'Immutable approval';
 END IF;
 IF b.state<>'draft' OR b.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Draft or fingerprint unavailable'; END IF;
 review:=public.review_campaign_legacy_second(b.campaign_id);
 IF review IS DISTINCT FROM b.legacy_review THEN RAISE EXCEPTION 'Stale historical review; prepare a new version'; END IF;
 SELECT count(DISTINCT value) INTO n FROM jsonb_array_elements_text(p_recipients);
 IF n<>jsonb_array_length(p_recipients) THEN RAISE EXCEPTION 'Duplicate selection'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_recipients) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(review->'recipients') x WHERE x->'recipient_id'=row AND x->'reasons'='[]'::jsonb) THEN RAISE EXCEPTION 'Ineligible or foreign recipient'; END IF;
 END LOOP;
 UPDATE public.email_campaign_batch_recipients i SET second_selected=true WHERE i.batch_id=b.id AND to_jsonb(i.recipient_id::text) IN(SELECT value FROM jsonb_array_elements(p_recipients));
 UPDATE public.email_campaign_batches SET state='approved',approved_at=now(),second_approval=approval,approval_note=p_note WHERE id=b.id;
 RETURN jsonb_build_object('status','approved','batch_id',b.id);
END $$;
-- No route can turn an imported parent into a new initial message.
ALTER FUNCTION crm_campaign_private.dispatch_reason(uuid) RENAME TO initial_dispatch_reason;
CREATE FUNCTION crm_campaign_private.dispatch_reason(p_item uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.email_campaign_batch_recipients i JOIN public.email_campaign_batches b ON b.id=i.batch_id WHERE i.id=p_item AND i.user_id=auth.uid() AND b.batch_kind='legacy_second') THEN RETURN 'legacy_second_only'; END IF;
 RETURN crm_campaign_private.initial_dispatch_reason(p_item);
END $$;
ALTER FUNCTION crm_campaign_private.second_reason(uuid) RENAME TO ordinary_second_reason;
CREATE FUNCTION crm_campaign_private.second_reason(p_item uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.email_campaign_batch_recipients; b public.email_campaign_batches;
BEGIN
 SELECT * INTO i FROM public.email_campaign_batch_recipients WHERE id=p_item AND user_id=auth.uid();
 SELECT * INTO b FROM public.email_campaign_batches WHERE id=i.batch_id AND user_id=auth.uid();
 IF b.batch_kind='legacy_second' THEN
  IF NOT i.second_selected OR b.second_approval IS NULL OR b.second_approval->>'wait_seconds' IS DISTINCT FROM '604800' THEN RETURN 'second_unapproved'; END IF;
  IF crm_campaign_private.legacy_parent(i.recipient_id) IS DISTINCT FROM i.legacy_parent_snapshot THEN RETURN 'legacy_parent_changed'; END IF;
 END IF;
 RETURN crm_campaign_private.ordinary_second_reason(p_item);
END $$;
ALTER FUNCTION public.approve_campaign_second_step(uuid,text,text,integer,uuid,text) RENAME TO approve_ordinary_campaign_second_step;
REVOKE ALL ON FUNCTION public.approve_ordinary_campaign_second_step(uuid,text,text,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.approve_campaign_second_step(p_batch uuid,p_subject text,p_message text,p_wait_seconds integer,p_key uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.email_campaign_batches WHERE id=p_batch AND batch_kind='legacy_second') THEN RAISE EXCEPTION 'Use explicit historical recipient review'; END IF;
 RETURN public.approve_ordinary_campaign_second_step(p_batch,p_subject,p_message,p_wait_seconds,p_key,p_note);
END $$;
CREATE FUNCTION crm_campaign_private.guard_legacy_draft() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='email_campaign_batches' THEN
  IF NEW.batch_kind IS DISTINCT FROM OLD.batch_kind OR NEW.legacy_review IS DISTINCT FROM OLD.legacy_review THEN RAISE EXCEPTION 'Immutable historical source'; END IF;
  IF OLD.batch_kind='legacy_second' AND NEW.state='approved' AND NEW.second_approval IS NULL THEN RAISE EXCEPTION 'Explicit second approval required'; END IF;
 ELSE
  IF OLD.legacy_parent_snapshot IS NOT NULL AND (NEW.legacy_parent_snapshot IS DISTINCT FROM OLD.legacy_parent_snapshot OR NEW.content IS DISTINCT FROM OLD.content OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id OR NEW.email IS DISTINCT FROM OLD.email OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN RAISE EXCEPTION 'Immutable historical evidence'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_legacy_draft BEFORE UPDATE ON public.email_campaign_batches FOR EACH ROW EXECUTE FUNCTION crm_campaign_private.guard_legacy_draft();
CREATE TRIGGER guard_legacy_draft BEFORE UPDATE ON public.email_campaign_batch_recipients FOR EACH ROW EXECUTE FUNCTION crm_campaign_private.guard_legacy_draft();
REVOKE ALL ON FUNCTION crm_campaign_private.legacy_second_policy(),crm_campaign_private.legacy_parent(uuid),crm_campaign_private.dispatch_reason(uuid),crm_campaign_private.second_reason(uuid),crm_campaign_private.guard_legacy_draft() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.review_campaign_legacy_second(uuid),public.prepare_campaign_legacy_second(uuid,text),public.approve_campaign_legacy_second(uuid,text,jsonb,uuid,text),public.approve_campaign_second_step(uuid,text,text,integer,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.review_campaign_legacy_second(uuid),public.prepare_campaign_legacy_second(uuid,text),public.approve_campaign_legacy_second(uuid,text,jsonb,uuid,text),public.approve_campaign_second_step(uuid,text,text,integer,uuid,text) TO authenticated;
CREATE FUNCTION public.get_campaign_legacy_second(p_campaign uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.email_campaigns WHERE id=p_campaign AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Campaign unavailable'; END IF;
 RETURN (SELECT jsonb_build_object('id',b.id,'state',b.state,'review',b.legacy_review,'second_approval',b.second_approval)
 FROM public.email_campaign_batches b WHERE b.campaign_id=p_campaign AND b.user_id=auth.uid() AND b.batch_kind='legacy_second' AND b.state<>'cancelled');
END $$;
REVOKE ALL ON FUNCTION public.get_campaign_legacy_second(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_legacy_second(uuid) TO authenticated;
ALTER FUNCTION public.campaign_batch_overview(uuid) RENAME TO initial_campaign_batch_overview;
REVOKE ALL ON FUNCTION public.initial_campaign_batch_overview(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.campaign_batch_overview(p_campaign_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(public.initial_campaign_batch_overview(p_campaign_id)) x
 WHERE EXISTS(SELECT 1 FROM public.email_campaign_batches b WHERE b.id=(x->>'id')::uuid AND b.user_id=auth.uid() AND b.batch_kind='initial')
$$;
REVOKE ALL ON FUNCTION public.campaign_batch_overview(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.campaign_batch_overview(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
