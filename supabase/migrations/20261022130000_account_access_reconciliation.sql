-- Product reconciliation found gifted/lifetime accounts. Active access is not
-- proof of payment: record it without promoting the sales funnel to Cliente.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.crm_ingest_account_event(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE addr text := lower(btrim(p->>'owner_email')); at timestamptz := (p->>'occurred_at')::timestamptz;
  ev text := p->>'event'; cid uuid; account text; promote text; label text; product text := coalesce(nullif(p->>'product', ''), 'barberias');
BEGIN
  IF NOT crm_ledger_private.valid_address(addr) OR at IS NULL OR at > now() + interval '5 minutes'
    OR coalesce(p->>'event_key', '') = '' OR length(p->>'event_key') > 300 THEN RAISE EXCEPTION 'invalid account event'; END IF;
  account := CASE ev WHEN 'account.created' THEN 'trial' WHEN 'trial.started' THEN 'trial'
    WHEN 'trial.ended' THEN 'trial_encerrado' WHEN 'subscription.active' THEN 'ativo'
    WHEN 'subscription.canceled' THEN 'cancelado'
    WHEN 'account.access_granted' THEN 'ativo' WHEN 'account.access_revoked' THEN 'cancelado' ELSE NULL END;
  promote := CASE ev WHEN 'account.created' THEN 'Lead' WHEN 'trial.started' THEN 'Lead'
    WHEN 'subscription.active' THEN 'Cliente' WHEN 'subscription.canceled' THEN 'Inativo' ELSE NULL END;
  label := CASE ev WHEN 'account.created' THEN 'conta criada, teste grátis iniciado'
    WHEN 'trial.started' THEN 'teste grátis iniciado' WHEN 'onboarding.completed' THEN 'configuração inicial concluída'
    WHEN 'first_appointment' THEN 'primeiro agendamento recebido' WHEN 'trial.ended' THEN 'teste grátis encerrado'
    WHEN 'subscription.active' THEN 'assinatura ativa' WHEN 'subscription.canceled' THEN 'assinatura cancelada'
    WHEN 'account.access_granted' THEN 'acesso ativo por cortesia/vitalício (não representa pagamento)'
    WHEN 'account.access_revoked' THEN 'acesso de cortesia encerrado' ELSE NULL END;
  IF label IS NULL THEN RAISE EXCEPTION 'unknown account event'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email-ledger:' || addr, 0));
  IF EXISTS (SELECT 1 FROM crm_ledger_private.account_events WHERE event_key = p->>'event_key') THEN
    RETURN jsonb_build_object('ok', true, 'status', 'duplicate');
  END IF;
  cid := crm_ledger_private.resolve_contact(addr, NULL, jsonb_build_object(
    'name', coalesce(nullif(p->>'owner_name', ''), p->>'account_name'), 'company', p->>'account_name',
    'status', CASE promote WHEN 'Cliente' THEN 'Cliente' WHEN 'Inativo' THEN 'Inativo' ELSE 'Lead' END, 'origin', 'cadastro', 'product', product, 'account_status', account,
    'account_ref', p->>'account_ref', 'account_authoritative', 'true', 'promote_status', promote));
  INSERT INTO crm_ledger_private.account_events(event_key, contact_id, event, occurred_at) VALUES (p->>'event_key', cid, ev, at);
  INSERT INTO public.activities(user_id, contact_id, type, channel, content)
  VALUES (crm_ledger_private.tenant(), cid, 'note', 'sistema',
    initcap(product) || ': ' || label || coalesce(' — ' || nullif(left(p->>'account_name', 120), ''), '') || '.');
  PERFORM crm_ledger_private.bind_email_identity(cid, addr);
  RETURN jsonb_build_object('ok', true, 'status', 'recorded', 'contact_id', cid);
END
$$;

REVOKE ALL ON FUNCTION public.crm_ingest_account_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ingest_account_event(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
