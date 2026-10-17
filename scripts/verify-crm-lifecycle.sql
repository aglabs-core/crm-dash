-- Production verification uses synthetic identities inside a subtransaction
-- that is always rolled back. No contact, activity, payment or event survives.
DO $verify$
DECLARE receipt jsonb; cid uuid; marker text := 'crm-qa-' || gen_random_uuid()::text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.contacts WHERE whatsapp='0000000000001' OR instagram_id='000000000000001') THEN
    RAISE EXCEPTION 'Synthetic identity already exists; verification aborted';
  END IF;
  BEGIN
    receipt := public.maia_whatsapp_intake('0000000000001');
    cid := (receipt->>'contact_id')::uuid;
    IF (SELECT status FROM public.contacts WHERE id=cid) <> 'Contato' THEN RAISE EXCEPTION 'Intake promoted a general contact'; END IF;
    PERFORM public.maia_whatsapp_contact(cid,jsonb_build_object('whatsapp','0000000000001','status','Atendimento'));
    IF (SELECT status FROM public.contacts WHERE id=cid) <> 'Contato' THEN RAISE EXCEPTION 'Missing qualification advanced contact'; END IF;
    PERFORM public.maia_whatsapp_contact(cid,jsonb_build_object('whatsapp','0000000000001','status','Lead','commercial_intent',true,'qualification_reason','Solicitou proposta comercial para projeto sintético.'));
    IF (SELECT status FROM public.contacts WHERE id=cid) <> 'Lead' THEN RAISE EXCEPTION 'Explicit qualification failed'; END IF;
    PERFORM public.maia_contact_intake('email',marker || '@example.invalid','synthetic',marker);
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE email=marker || '@example.invalid' AND status='Contato') THEN RAISE EXCEPTION 'Email intake failed'; END IF;
    PERFORM public.registrar_lead_instagram('000000000000001','synthetic','PROMPT','Synthetic','comentario',marker);
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE instagram_id='000000000000001' AND status='Contato') THEN RAISE EXCEPTION 'Instagram capture advanced contact'; END IF;
    receipt := public.ingest_payment_transaction('0af00833-c1f7-42f4-9543-a5e0ff6f55fc','asaas',marker,'paid',1,0,'BRL','Synthetic',null,null,marker || '-buyer@example.invalid',null,null);
    cid := (receipt->>'contact_id')::uuid;
    PERFORM public.ingest_payment_transaction('0af00833-c1f7-42f4-9543-a5e0ff6f55fc','asaas',marker,'refunded',1,1,'BRL','Synthetic',null,null,marker || '-buyer@example.invalid',null,null);
    PERFORM public.ingest_payment_transaction('0af00833-c1f7-42f4-9543-a5e0ff6f55fc','asaas',marker,'paid',1,0,'BRL','Synthetic',null,null,marker || '-buyer@example.invalid',null,null);
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id=cid AND status='Inativo' AND amount=0) THEN RAISE EXCEPTION 'Paid replay reactivated a refunded customer'; END IF;
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Discard synthetic verification';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$verify$;
