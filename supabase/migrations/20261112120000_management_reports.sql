-- Reports were downloading full contacts/payment ledgers before aggregating in the browser.
-- One invoker RPC returns aggregates only, with the caller's existing RLS and a single database snapshot.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.crm_management_report(p_product text DEFAULT NULL, p_days integer DEFAULT NULL, p_months integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF (p_days IS NOT NULL AND p_days NOT IN (30,90,365)) OR p_months NOT BETWEEN 1 AND 12 OR p_months IS NULL OR length(p_product)>160 THEN
    RAISE EXCEPTION 'Invalid report window';
  END IF;
  WITH
  c_scope AS MATERIALIZED (SELECT id,produto,status,prospecting_pool,amount,created_at,closed_at,email,phone,whatsapp,instagram
    FROM public.contacts WHERE p_product IS NULL OR nullif(btrim(produto),'')=p_product),
  c AS MATERIALIZED (SELECT * FROM c_scope WHERE prospecting_pool IS NOT TRUE AND status <> 'Contato'
    AND created_at <= now() AND (p_days IS NULL OR created_at >= now()-make_interval(days=>p_days))),
  p AS MATERIALIZED (SELECT *, CASE WHEN currency='BRL' AND status IN ('paid','partially_refunded') THEN net_amount ELSE 0 END AS revenue
    FROM public.payment_transactions WHERE (p_product IS NULL OR nullif(btrim(product),'')=p_product)
    AND (paid_at IS NULL AND p_days IS NULL OR paid_at<=now() AND (p_days IS NULL OR paid_at>=now()-make_interval(days=>p_days)))),
  months AS (SELECT generate_series(date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')-make_interval(months=>p_months-1),
    date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') AS month),
  stage_defs(stage,label,tone,position) AS (VALUES ('Lead','Lead','blue',1),('Contatado','Contatado','indigo',2),
    ('Atendimento','Atendimento','purple',3),('Proposta','Proposta','amber',4),('Pagamento','Pagamento','orange',5),('Cliente','Cliente / Inativo','emerald',6)),
  product_keys AS (SELECT coalesce(nullif(btrim(produto),''),'Sem produto') AS product FROM c
    UNION SELECT coalesce(nullif(btrim(product),''),'Sem produto') FROM p),
  payment_months AS (SELECT date_trunc('month',paid_at AT TIME ZONE 'America/Sao_Paulo') AS month,sum(revenue) AS revenue FROM p GROUP BY 1),
  contact_months AS (SELECT date_trunc('month',closed_at AT TIME ZONE 'America/Sao_Paulo') AS month,
    coalesce(sum(amount) FILTER(WHERE status='Arquivado'),0) AS lost,
    round(100.0*count(*) FILTER(WHERE status IN ('Cliente','Inativo'))/nullif(count(*),0)) AS rate
    FROM c WHERE status IN ('Cliente','Inativo','Arquivado') GROUP BY 1),
  contact_products AS (SELECT coalesce(nullif(btrim(produto),''),'Sem produto') AS product,count(*) AS deals,
    coalesce(sum(amount) FILTER(WHERE status IN ('Lead','Contatado','Atendimento','Proposta','Pagamento')),0) AS open_value,
    round(100.0*count(*) FILTER(WHERE status IN ('Cliente','Inativo'))/nullif(count(*) FILTER(WHERE status IN ('Cliente','Inativo','Arquivado')),0)) AS rate
    FROM c GROUP BY 1),
  payment_products AS (SELECT coalesce(nullif(btrim(product),''),'Sem produto') AS product,sum(revenue) AS revenue,
    count(*) FILTER(WHERE revenue>0) AS paid_count FROM p GROUP BY 1),
  identities AS (SELECT DISTINCT c_scope.id, identity FROM c_scope CROSS JOIN LATERAL
    (VALUES (nullif(lower(btrim(email)),'')),(nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'')),
    (nullif(regexp_replace(coalesce(whatsapp,''),'[^0-9]','','g'),''))) i(identity) WHERE identity IS NOT NULL),
  quality AS (SELECT jsonb_build_object(
    'totalContacts',(SELECT count(*) FROM c_scope),
    'missingProduct',(SELECT count(*) FROM c_scope WHERE nullif(btrim(produto),'') IS NULL),
    'missingChannel',(SELECT count(*) FROM c_scope WHERE coalesce(nullif(btrim(email),''),nullif(btrim(phone),''),nullif(btrim(whatsapp),''),nullif(btrim(instagram),'')) IS NULL),
    'sharedIdentityGroups',(SELECT count(*) FROM (SELECT identity FROM identities GROUP BY identity HAVING count(*)>1) d),
    'unassignedTasks',(SELECT count(*) FROM public.tasks t WHERE t.status='pending' AND t.assigned_to IS NULL
      AND (p_product IS NULL OR EXISTS(SELECT 1 FROM c_scope WHERE id=t.contact_id))),
    'paymentsWithoutContact',(SELECT count(*) FROM p WHERE contact_id IS NULL),
    'paymentsWithoutDate',(SELECT count(*) FROM p WHERE paid_at IS NULL)
  ) AS value)
  SELECT jsonb_build_object(
    'version',1,'consultedAt',now(),'timeZone','America/Sao_Paulo','product',p_product,'days',p_days,
    'products',(SELECT coalesce(jsonb_agg(product ORDER BY product),'[]') FROM (
      SELECT nullif(btrim(produto),'') product FROM public.contacts UNION SELECT nullif(btrim(product),'') FROM public.payment_transactions) names WHERE product IS NOT NULL),
    'contactsCount',(SELECT count(*) FROM c),'quality',(SELECT value FROM quality),
    'journey',public.crm_journey_report(p_product,coalesce(p_days,30)),
    'metrics',jsonb_build_object(
      'revenue',(SELECT coalesce(sum(revenue),0) FROM p),
      'pipeline',(SELECT coalesce(sum(amount),0) FROM c WHERE status IN ('Lead','Contatado','Atendimento','Proposta','Pagamento')),
      'avgDealSize',(SELECT CASE WHEN count(*) FILTER(WHERE revenue>0)>0 THEN coalesce(sum(revenue),0)/count(*) FILTER(WHERE revenue>0) ELSE 0 END FROM p),
      'winRate',(SELECT 100.0*count(*) FILTER(WHERE status IN ('Cliente','Inativo'))/nullif(count(*) FILTER(WHERE status IN ('Cliente','Inativo','Arquivado')),0) FROM c),
      'closed',(SELECT count(*) FROM c WHERE status IN ('Cliente','Inativo','Arquivado')),
      'funnel',(SELECT jsonb_agg(jsonb_build_object('stage',stage,'label',label,'tone',tone,
        'reached',(SELECT count(*) FROM c WHERE c.status=stage OR stage='Cliente' AND c.status='Inativo'),
        'value',(SELECT coalesce(sum(amount),0) FROM c WHERE c.status=stage OR stage='Cliente' AND c.status='Inativo')) ORDER BY position) FROM stage_defs),
      'series',(SELECT jsonb_agg(jsonb_build_object('key',to_char(m.month,'YYYY-MM'),
        'name',(ARRAY['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'])[extract(month FROM m.month)::int]||'/'||to_char(m.month,'YY'),
        'revenue',coalesce(pm.revenue,0),'lost',coalesce(cm.lost,0),'rate',cm.rate
      ) ORDER BY m.month) FROM months m LEFT JOIN payment_months pm ON pm.month=m.month LEFT JOIN contact_months cm ON cm.month=m.month),
      'products',(SELECT coalesce(jsonb_agg(jsonb_build_object('produto',product,'revenue',revenue,'count',count) ORDER BY revenue DESC,product),'[]')
        FROM (SELECT product,revenue,paid_count AS count FROM payment_products WHERE revenue>0) revenue_groups),
      'leadsProduct',(SELECT coalesce(jsonb_agg(jsonb_build_object('produto',product,'count',count) ORDER BY count DESC,product),'[]') FROM
        (SELECT product,deals AS count FROM contact_products) contact_groups),
      'perf',(SELECT coalesce(jsonb_agg(jsonb_build_object('produto',k.product,
        'deals',coalesce(cp.deals,0),'openValue',coalesce(cp.open_value,0),'wonValue',coalesce(pp.revenue,0),'rate',cp.rate
      ) ORDER BY coalesce(pp.revenue,0) DESC,coalesce(cp.deals,0) DESC,k.product),'[]') FROM product_keys k
        LEFT JOIN contact_products cp ON cp.product=k.product LEFT JOIN payment_products pp ON pp.product=k.product)
    )
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_management_report(text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_management_report(text,integer,integer) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS payment_transactions_report_paid_idx ON public.payment_transactions(paid_at,product);
NOTIFY pgrst, 'reload schema';
COMMIT;
