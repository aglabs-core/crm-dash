-- A saved draft was mutable and did not prove which personalized messages were
-- reviewed. Freeze an approved version without sending or changing the funnel.
CREATE SCHEMA IF NOT EXISTS crm_campaign_private;
REVOKE ALL ON SCHEMA crm_campaign_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA crm_campaign_private TO authenticated;

CREATE TABLE IF NOT EXISTS public.email_campaign_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  user_id uuid NOT NULL,
  approval_key uuid NOT NULL,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'approved' CHECK(state IN ('approved','paused','cancelled')),
  sender_email text NOT NULL,
  subject text NOT NULL,
  content_text text NOT NULL,
  reply_to text,
  product text NOT NULL,
  approval_note text NOT NULL CHECK(length(btrim(approval_note)) BETWEEN 8 AND 1000),
  approved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,approval_key),
  UNIQUE(id,user_id),
  FOREIGN KEY(campaign_id,user_id) REFERENCES public.email_campaigns(id,user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_batch_active_idx ON public.email_campaign_batches(campaign_id)
  WHERE state IN ('approved','paused');
CREATE INDEX IF NOT EXISTS email_campaign_batch_owner_idx ON public.email_campaign_batches(user_id,campaign_id,approved_at DESC);
CREATE TABLE IF NOT EXISTS public.email_campaign_batch_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  user_id uuid NOT NULL,
  recipient_id uuid NOT NULL, -- Historical identity survives removal from a cancelled draft.
  email text NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  content text NOT NULL,
  review_note text NOT NULL,
  FOREIGN KEY(batch_id,user_id) REFERENCES public.email_campaign_batches(id,user_id) ON DELETE RESTRICT,
  UNIQUE(batch_id,recipient_id),
  UNIQUE(batch_id,email)
);
CREATE INDEX IF NOT EXISTS email_campaign_batch_recipient_idx ON public.email_campaign_batch_recipients(recipient_id);
ALTER TABLE public.email_campaign_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_batch_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read approved campaign batches" ON public.email_campaign_batches;
CREATE POLICY "owners read approved campaign batches" ON public.email_campaign_batches FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS "owners read frozen campaign recipients" ON public.email_campaign_batch_recipients;
CREATE POLICY "owners read frozen campaign recipients" ON public.email_campaign_batch_recipients FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON public.email_campaign_batches,public.email_campaign_batch_recipients FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.email_campaign_batches,public.email_campaign_batch_recipients TO authenticated;
GRANT SELECT ON public.email_campaign_batches,public.email_campaign_batch_recipients TO service_role;

CREATE OR REPLACE FUNCTION crm_campaign_private.recipient_reason(owner_id uuid,recipient_id uuid,product text,address text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.email_campaign_recipients; contact public.contacts;
BEGIN
  IF owner_id IS DISTINCT FROM auth.uid() THEN RETURN 'Contato indisponível'; END IF;
  SELECT * INTO r FROM public.email_campaign_recipients x WHERE x.id=recipient_id AND x.user_id=owner_id;
  IF NOT FOUND THEN RETURN 'Destinatário indisponível'; END IF;
  SELECT * INTO contact FROM public.contacts c WHERE c.id=r.contact_id AND c.user_id=owner_id;
  IF NOT FOUND THEN RETURN 'Contato indisponível'; END IF;
  IF contact.outreach_status IS DISTINCT FROM 'contactable' THEN RETURN 'Contato sem revisão ou bloqueado'; END IF;
  IF lower(btrim(contact.email)) IS DISTINCT FROM address OR address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN 'E-mail mudou ou está inválido'; END IF;
  IF public.campaign_product_key(contact.produto) IS DISTINCT FROM public.campaign_product_key(product) THEN RETURN 'Produto mudou'; END IF;
  IF public.campaign_email_is_suppressed(address) THEN RETURN 'Endereço com descadastro, reclamação ou falha permanente'; END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION crm_campaign_private.recipient_reason(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_campaign_private.recipient_reason(uuid,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_email_campaign_batch(p_campaign_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE campaign public.email_campaigns; audience jsonb; snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO STRICT campaign FROM public.email_campaigns WHERE id=p_campaign_id AND user_id=auth.uid();
  IF campaign.status<>'draft' OR campaign.provider<>'brevo' THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF length(btrim(campaign.content_text))=0 OR campaign.sender_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Complete sender and message'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'recipient_id',r.id,'email',lower(btrim(r.email_snapshot)),
    'name',coalesce(nullif(btrim(c.name),''),'você'),
    'subject',replace(replace(campaign.subject,'{{nome}}',coalesce(nullif(btrim(c.name),''),'você')),'{{produto}}',campaign.product),
    'content',replace(replace(campaign.content_text,'{{nome}}',coalesce(nullif(btrim(c.name),''),'você')),'{{produto}}',campaign.product),
    'review_note',r.review_note,
    'reason',CASE WHEN r.provider_message_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.email_campaign_events e WHERE e.recipient_id=r.id) THEN 'Envio externo ou histórico já registrado'
      WHEN EXISTS(SELECT 1 FROM public.email_campaign_recipients duplicate WHERE duplicate.campaign_id=r.campaign_id AND duplicate.id<>r.id AND lower(btrim(duplicate.email_snapshot))=lower(btrim(r.email_snapshot))) THEN 'E-mail repetido' ELSE crm_campaign_private.recipient_reason(campaign.user_id,r.id,campaign.product,lower(btrim(r.email_snapshot))) END
  ) ORDER BY r.id),'[]'::jsonb) INTO audience
  FROM public.email_campaign_recipients r LEFT JOIN public.contacts c ON c.id=r.contact_id AND c.user_id=campaign.user_id
  WHERE r.campaign_id=campaign.id AND r.user_id=campaign.user_id;
  IF jsonb_array_length(audience) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Review between 1 and 200 recipients'; END IF;
  snapshot:=jsonb_build_object('campaign_id',campaign.id,'subject',campaign.subject,'content_text',campaign.content_text,'sender_email',campaign.sender_email,
    'reply_to',campaign.reply_to,'product',campaign.product,'audience_basis',campaign.audience_basis,'recipients',audience);
  RETURN snapshot || jsonb_build_object('fingerprint',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
END
$$;
REVOKE ALL ON FUNCTION public.review_email_campaign_batch(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_email_campaign_batch(uuid) TO authenticated;

-- The only privileged writes are in this private, non-exposed schema. Every
-- entry point checks auth.uid() and ownership; clients cannot forge snapshots.
CREATE OR REPLACE FUNCTION crm_campaign_private.approve_batch(p_campaign_id uuid,p_fingerprint text,p_approval_key uuid,p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); campaign public.email_campaigns; snapshot jsonb; existing public.email_campaign_batches; batch_id uuid;
BEGIN
  IF actor IS NULL OR p_approval_key IS NULL THEN RAISE EXCEPTION 'Authentication and approval key required'; END IF;
  SELECT * INTO STRICT campaign FROM public.email_campaigns WHERE id=p_campaign_id AND user_id=actor FOR UPDATE;
  SELECT * INTO existing FROM public.email_campaign_batches WHERE user_id=actor AND approval_key=p_approval_key;
  IF FOUND THEN
    IF existing.campaign_id<>p_campaign_id OR existing.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Approval key conflict'; END IF;
    RETURN existing.id;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1000 THEN RAISE EXCEPTION 'Approval evidence required'; END IF;
  IF EXISTS(SELECT 1 FROM public.email_campaign_batches b WHERE b.campaign_id=campaign.id AND b.state<>'cancelled') THEN RAISE EXCEPTION 'Campaign already approved'; END IF;
  PERFORM id FROM public.email_campaign_recipients WHERE campaign_id=campaign.id ORDER BY id FOR SHARE;
  PERFORM c.id FROM public.contacts c JOIN public.email_campaign_recipients r ON r.contact_id=c.id WHERE r.campaign_id=campaign.id ORDER BY c.id FOR SHARE OF c;
  snapshot:=public.review_email_campaign_batch(campaign.id);
  IF snapshot->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Review changed; reload the final messages'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'recipients') r WHERE r->>'reason' IS NOT NULL) THEN RAISE EXCEPTION 'Audience unavailable'; END IF;
  INSERT INTO public.email_campaign_batches(campaign_id,user_id,approval_key,fingerprint,sender_email,subject,content_text,reply_to,product,approval_note)
    VALUES(campaign.id,actor,p_approval_key,p_fingerprint,campaign.sender_email,campaign.subject,campaign.content_text,campaign.reply_to,campaign.product,btrim(p_note)) RETURNING id INTO batch_id;
  INSERT INTO public.email_campaign_batch_recipients(batch_id,user_id,recipient_id,email,name,subject,content,review_note)
    SELECT batch_id,actor,(r->>'recipient_id')::uuid,r->>'email',r->>'name',r->>'subject',r->>'content',r->>'review_note' FROM jsonb_array_elements(snapshot->'recipients') r;
  RETURN batch_id;
END
$$;
REVOKE ALL ON FUNCTION crm_campaign_private.approve_batch(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_campaign_private.approve_batch(uuid,text,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.approve_email_campaign_batch(p_campaign_id uuid,p_fingerprint text,p_approval_key uuid,p_note text) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT crm_campaign_private.approve_batch(p_campaign_id,p_fingerprint,p_approval_key,p_note) $$;
REVOKE ALL ON FUNCTION public.approve_email_campaign_batch(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_email_campaign_batch(uuid,text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION crm_campaign_private.set_batch_state(p_batch_id uuid,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE batch public.email_campaign_batches;
BEGIN
  IF auth.uid() IS NULL OR p_state IS NULL OR p_state NOT IN ('approved','paused','cancelled') THEN RAISE EXCEPTION 'Invalid state'; END IF;
  PERFORM c.id FROM public.email_campaigns c JOIN public.email_campaign_batches b ON b.campaign_id=c.id WHERE b.id=p_batch_id AND b.user_id=auth.uid() AND c.user_id=auth.uid() FOR UPDATE OF c;
  SELECT * INTO STRICT batch FROM public.email_campaign_batches WHERE id=p_batch_id AND user_id=auth.uid() FOR UPDATE;
  IF batch.state='cancelled' AND p_state<>'cancelled' THEN RAISE EXCEPTION 'Cancelled version is immutable'; END IF;
  UPDATE public.email_campaign_batches SET state=p_state,updated_at=now() WHERE id=batch.id;
END
$$;
REVOKE ALL ON FUNCTION crm_campaign_private.set_batch_state(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_campaign_private.set_batch_state(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_email_campaign_batch_state(p_batch_id uuid,p_state text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT crm_campaign_private.set_batch_state(p_batch_id,p_state) $$;
REVOKE ALL ON FUNCTION public.set_email_campaign_batch_state(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_email_campaign_batch_state(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.campaign_batch_overview(p_campaign_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'state',b.state,'approved_at',b.approved_at,'approval_note',b.approval_note,
    'sender_email',b.sender_email,'reply_to',b.reply_to,'subject',b.subject,
    'recipients',(SELECT coalesce(jsonb_agg(jsonb_build_object('recipient_id',i.recipient_id,'email',i.email,'name',i.name,'subject',i.subject,'content',i.content,
      'provider_message_id',r.provider_message_id,'reason',crm_campaign_private.recipient_reason(b.user_id,i.recipient_id,b.product,i.email)) ORDER BY i.recipient_id),'[]'::jsonb)
      FROM public.email_campaign_batch_recipients i LEFT JOIN public.email_campaign_recipients r ON r.id=i.recipient_id WHERE i.batch_id=b.id AND i.user_id=auth.uid())
  ) ORDER BY b.approved_at DESC,b.id),'[]'::jsonb) FROM public.email_campaign_batches b WHERE b.campaign_id=p_campaign_id AND b.user_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.campaign_batch_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campaign_batch_overview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_campaign_approved_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME='email_campaigns' THEN target:=OLD.id;
  ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD.campaign_id ELSE NEW.campaign_id END; END IF;
  -- Lock the same parent used by approval, so insertion cannot race approval.
  PERFORM id FROM public.email_campaigns WHERE id=target FOR UPDATE;
  IF current_user='authenticated' AND EXISTS(SELECT 1 FROM public.email_campaign_batches b WHERE b.campaign_id=target AND b.state IN ('approved','paused'))
    THEN RAISE EXCEPTION 'Cancel the approved version before editing the draft'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;
REVOKE ALL ON FUNCTION public.guard_campaign_approved_batch() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_campaign_approved_batch ON public.email_campaigns;
CREATE TRIGGER guard_campaign_approved_batch BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_approved_batch();
DROP TRIGGER IF EXISTS guard_recipient_approved_batch ON public.email_campaign_recipients;
CREATE TRIGGER guard_recipient_approved_batch BEFORE INSERT OR DELETE ON public.email_campaign_recipients FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_approved_batch();
