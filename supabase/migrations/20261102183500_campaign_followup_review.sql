-- Read-only preparation for a SECOND prospecting step. Reuses campaign and
-- recipient identities. This is NOT a queue, reservation or sending authority.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.review_email_campaign_followup(p_campaign_id uuid, p_wait_hours integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE campaign public.email_campaigns; audience jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO STRICT campaign FROM public.email_campaigns WHERE id = p_campaign_id AND user_id = auth.uid();
  IF campaign.provider <> 'brevo' THEN RAISE EXCEPTION 'Prospecting source must use Brevo'; END IF;
  IF p_wait_hours IS NOT NULL AND p_wait_hours NOT BETWEEN 1 AND 8760 THEN RAISE EXCEPTION 'Invalid explicit interval'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('contact_id',r.contact_id,'recipient_id',r.id,
    'reasons',to_jsonb(array_remove(ARRAY[
      CASE WHEN c.id IS NULL OR c.user_id IS DISTINCT FROM campaign.user_id OR lower(btrim(c.email)) IS DISTINCT FROM lower(btrim(r.email_snapshot)) THEN 'Vínculo de contato mudou' END,
      CASE WHEN c.outreach_status IS DISTINCT FROM 'contactable' THEN 'Contato sem revisão ou bloqueado' END,
      CASE WHEN c.account_status IS NOT NULL OR c.account_ref IS NOT NULL THEN 'Conta já cadastrada no produto' END,
      CASE WHEN NOT c.prospecting_pool OR c.status IS DISTINCT FROM 'Arquivado' THEN 'Relacionamento não é prospecção fria' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.contact_id=c.id
        AND p.user_id IN (c.user_id,crm_ledger_private.tenant()) AND public.campaign_product_key(p.product)=public.campaign_product_key(campaign.product)
        AND p.status IN ('paid','partially_refunded') AND p.net_amount>0) THEN 'Pagamento registrado' END,
      CASE WHEN m.id IS NULL OR m.delivered_at IS NULL THEN 'Sem envio inicial comprovado' END,
      CASE WHEN p_wait_hours IS NULL THEN 'Intervalo não definido'
        WHEN m.delivered_at + make_interval(hours=>p_wait_hours) > now() THEN 'Intervalo ainda não cumprido' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_message_events e JOIN public.email_messages x ON x.id=e.message_id
        WHERE x.user_id=crm_ledger_private.tenant() AND x.contact_id=c.id AND e.event_type IN ('soft_bounced','bounced','failed','deferred')) THEN 'Falha de entrega; revisar endereço' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_messages x WHERE x.user_id=crm_ledger_private.tenant() AND x.address=lower(btrim(r.email_snapshot))
        AND (x.direction='inbound' OR x.replied_at IS NOT NULL)) THEN 'Resposta recebida; atendimento deve revisar' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_messages x WHERE x.user_id=crm_ledger_private.tenant() AND x.address=lower(btrim(r.email_snapshot))
        AND x.status IN ('complained','unsubscribed','bounced')) THEN 'Supressão registrada' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_provider_suppressions s JOIN public.email_provider_connections pc ON pc.id=s.connection_id WHERE pc.user_id=campaign.user_id
        AND s.address_key=public.brevo_address_key(s.connection_id,lower(btrim(r.email_snapshot)))) THEN 'Supressão do provedor' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_campaign_recipients d WHERE d.campaign_id=campaign.id AND d.id<>r.id
        AND lower(btrim(d.email_snapshot))=lower(btrim(r.email_snapshot))) THEN 'E-mail repetido' END,
      CASE WHEN EXISTS(SELECT 1 FROM public.email_messages x WHERE x.user_id=crm_ledger_private.tenant() AND x.contact_id=c.id
        AND x.direction='outbound' AND x.category='prospeccao' AND x.id<>m.id AND x.sent_at>=m.sent_at) THEN 'Outra abordagem já registrada; revisar duplicidade' END
    ]::text[],NULL))) ORDER BY r.id),'[]'::jsonb) INTO audience
  FROM public.email_campaign_recipients r
  LEFT JOIN public.contacts c ON c.id=r.contact_id
  LEFT JOIN LATERAL (SELECT x.* FROM public.email_messages x WHERE x.user_id=crm_ledger_private.tenant()
    AND crm_ledger_private.contact_owner(c.user_id) AND x.contact_id=r.contact_id AND x.campaign_id=campaign.id AND x.recipient_id=r.id
    AND x.address=lower(btrim(r.email_snapshot)) AND x.direction='outbound' AND x.category='prospeccao'
    ORDER BY x.sent_at,x.id LIMIT 1) m ON true
  WHERE r.campaign_id=campaign.id AND r.user_id=auth.uid();
  RETURN jsonb_build_object('campaign_id',campaign.id,'mode','preparation_only','executor_available',false,
    'wait_hours',p_wait_hours,'recipients',audience);
END $$;
REVOKE ALL ON FUNCTION public.review_email_campaign_followup(uuid,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_email_campaign_followup(uuid,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
