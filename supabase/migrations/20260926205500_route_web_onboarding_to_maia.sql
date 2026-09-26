-- After a web-service payment, the customer-facing first step belongs to Maia.
-- Keep a single payment-linked task; production still waits for approved scope and materials.

CREATE OR REPLACE FUNCTION public.ingest_payment_with_onboarding(
  p_user_id uuid,
  p_gateway text,
  p_external_id text,
  p_status text,
  p_amount numeric,
  p_refunded_amount numeric DEFAULT 0,
  p_currency text DEFAULT 'BRL',
  p_product text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_documento text DEFAULT NULL,
  p_provider_product_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  payment_result jsonb;
  source_payment public.payment_transactions%ROWTYPE;
  onboarding_task_id uuid;
  onboarding_created boolean := false;
BEGIN
  payment_result := public.ingest_payment_transaction(
    p_user_id, p_gateway, p_external_id, p_status, p_amount,
    p_refunded_amount, p_currency, p_product, p_paid_at, p_name,
    p_email, p_phone, p_documento
  );

  -- This is the stable Cakto product ID, not its editable display name.
  IF lower(btrim(p_gateway)) <> 'cakto'
    OR p_provider_product_id IS DISTINCT FROM 'eafbeb9c-2689-4f1a-9ee1-37b51d7f90b4'
  THEN
    RETURN payment_result;
  END IF;

  SELECT * INTO source_payment
  FROM public.payment_transactions
  WHERE id = (payment_result ->> 'transaction_id')::uuid
    AND user_id = p_user_id;

  IF source_payment.id IS NULL OR source_payment.contact_id IS NULL THEN
    RAISE EXCEPTION 'payment onboarding contact not found';
  END IF;

  -- A stale paid replay after a refund must not start a new onboarding.
  IF source_payment.status <> 'paid' THEN
    RETURN payment_result;
  END IF;

  INSERT INTO public.tasks (
    user_id, contact_id, payment_transaction_id, title, description,
    due_date, status, priority, assigned_to
  ) VALUES (
    source_payment.user_id,
    source_payment.contact_id,
    source_payment.id,
    'Acolher cliente após compra de desenvolvimento web',
    'Pagamento da implantação confirmado. Maia: iniciar acolhimento no canal oficial, confirmar objetivo e coletar o briefing sem solicitar senhas. Registrar respostas e pendências no CRM. Encaminhar escopo à administração; produção só após escopo aprovado e materiais recebidos.',
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'pending', 'Alta', 'maia'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO onboarding_task_id;

  onboarding_created := onboarding_task_id IS NOT NULL;
  IF onboarding_task_id IS NULL THEN
    SELECT id INTO onboarding_task_id
    FROM public.tasks
    WHERE payment_transaction_id = source_payment.id;
  END IF;

  IF onboarding_task_id IS NULL THEN
    RAISE EXCEPTION 'payment onboarding task could not be recorded';
  END IF;

  RETURN payment_result || jsonb_build_object(
    'onboarding_task_id', onboarding_task_id,
    'onboarding_created', onboarding_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_payment_with_onboarding(
  uuid, text, text, text, numeric, numeric, text, text,
  timestamptz, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_payment_with_onboarding(
  uuid, text, text, text, numeric, numeric, text, text,
  timestamptz, text, text, text, text, text
) TO service_role;

