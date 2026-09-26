-- Separate provider payments from the contact funnel.
--
-- A contact can buy more than once, while a provider can replay the same
-- webhook. Keeping the provider identifier on contacts loses purchase history
-- and makes revenue depend on the last update. This ledger keeps one row per
-- provider transaction and exposes a service-role-only RPC that resolves the
-- contact and records the payment in the same database transaction.

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  gateway text NOT NULL,
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  product text,
  currency text NOT NULL DEFAULT 'BRL',
  amount numeric(15, 2) NOT NULL,
  refunded_amount numeric(15, 2) NOT NULL DEFAULT 0,
  net_amount numeric(15, 2)
    GENERATED ALWAYS AS (amount - refunded_amount) STORED,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_transactions_gateway_check
    CHECK (gateway IN ('stripe', 'asaas', 'mercadopago', 'cakto')),
  CONSTRAINT payment_transactions_status_check
    CHECK (status IN ('paid', 'partially_refunded', 'refunded', 'chargeback', 'canceled')),
  CONSTRAINT payment_transactions_currency_check
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_transactions_external_id_check
    CHECK (length(btrim(external_id)) BETWEEN 1 AND 255),
  CONSTRAINT payment_transactions_amount_check
    CHECK (amount >= 0),
  CONSTRAINT payment_transactions_refunded_amount_check
    CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  CONSTRAINT payment_transactions_user_gateway_external_key
    UNIQUE (user_id, gateway, external_id)
);

-- Preserve the valid payment snapshot already stored on contacts. Rows without
-- a usable provider identifier remain untouched and can be reconciled later
-- without blocking the migration.
INSERT INTO public.payment_transactions (
  user_id, contact_id, gateway, external_id, status, product,
  currency, amount, refunded_amount, paid_at
)
SELECT
  contacts.user_id,
  contacts.id,
  contacts.gateway,
  btrim(contacts.external_id),
  'paid',
  contacts.produto,
  'BRL',
  greatest(coalesce(contacts.amount, 0), 0),
  0,
  coalesce(contacts.closed_at, contacts.created_at)
FROM public.contacts
WHERE contacts.gateway IN ('stripe', 'asaas', 'mercadopago', 'cakto')
  AND contacts.external_id IS NOT NULL
  AND length(btrim(contacts.external_id)) BETWEEN 1 AND 255
ON CONFLICT (user_id, gateway, external_id) DO NOTHING;

COMMENT ON TABLE public.payment_transactions IS
  'Livro-caixa operacional: uma linha por transacao externa, separado do estagio do contato.';
COMMENT ON COLUMN public.payment_transactions.external_id IS
  'Identificador estavel do pagamento no gateway; replays atualizam a mesma linha.';
COMMENT ON COLUMN public.payment_transactions.refunded_amount IS
  'Total acumulado devolvido pelo gateway, usado de forma monotona para tolerar replays fora de ordem.';

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_paid_at
  ON public.payment_transactions(user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_contact_paid_at
  ON public.payment_transactions(contact_id, paid_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_status
  ON public.payment_transactions(user_id, status);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own payment transactions"
  ON public.payment_transactions;
CREATE POLICY "users read own payment transactions"
ON public.payment_transactions
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins read all payment transactions"
  ON public.payment_transactions;
CREATE POLICY "admins read all payment transactions"
ON public.payment_transactions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE admin_users.id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.payment_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.touch_payment_transaction_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS set_payment_transaction_updated_at
  ON public.payment_transactions;
CREATE TRIGGER set_payment_transaction_updated_at
BEFORE UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.touch_payment_transaction_updated_at();

CREATE OR REPLACE FUNCTION public.ingest_payment_transaction(
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
  p_documento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  normalized_gateway text := lower(btrim(p_gateway));
  normalized_external_id text := btrim(p_external_id);
  normalized_status text := lower(btrim(p_status));
  normalized_currency text := upper(btrim(p_currency));
  normalized_name text := nullif(btrim(p_name), '');
  normalized_email text := nullif(lower(btrim(p_email)), '');
  normalized_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  normalized_document text := nullif(regexp_replace(coalesce(p_documento, ''), '[^0-9]', '', 'g'), '');
  normalized_product text := nullif(btrim(p_product), '');
  candidate_ids uuid[];
  resolved_contact_id uuid;
  transaction_id uuid;
  transaction_created boolean := false;
  existing_transaction public.payment_transactions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR normalized_gateway NOT IN ('stripe', 'asaas', 'mercadopago', 'cakto')
    OR normalized_external_id IS NULL
    OR length(normalized_external_id) NOT BETWEEN 1 AND 255
    OR normalized_status NOT IN ('paid', 'partially_refunded', 'refunded', 'chargeback', 'canceled')
    OR p_amount IS NULL
    OR p_amount < 0
    OR p_refunded_amount IS NULL
    OR p_refunded_amount < 0
    OR p_refunded_amount > p_amount
    OR normalized_currency !~ '^[A-Z]{3}$'
    OR (normalized_email IS NULL AND normalized_phone IS NULL AND normalized_document IS NULL)
    OR (normalized_email IS NOT NULL AND (length(normalized_email) > 320 OR position('@' IN normalized_email) < 2))
    OR (normalized_phone IS NOT NULL AND length(normalized_phone) NOT BETWEEN 8 AND 20)
    OR (normalized_document IS NOT NULL AND length(normalized_document) > 32)
    OR (normalized_name IS NOT NULL AND length(normalized_name) > 160)
    OR (normalized_product IS NOT NULL AND length(normalized_product) > 255)
  THEN
    RAISE EXCEPTION 'invalid payment transaction';
  END IF;

  -- Serializes identity resolution for one tenant. This prevents two distinct
  -- payments for the same new buyer from creating two contacts concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT *
  INTO existing_transaction
  FROM public.payment_transactions
  WHERE user_id = p_user_id
    AND gateway = normalized_gateway
    AND external_id = normalized_external_id
  FOR UPDATE;

  IF existing_transaction.id IS NOT NULL
    AND (
      existing_transaction.currency IS DISTINCT FROM normalized_currency
      OR existing_transaction.amount IS DISTINCT FROM p_amount
    )
  THEN
    RAISE EXCEPTION 'payment transaction amount or currency conflict';
  END IF;

  IF existing_transaction.id IS NULL AND normalized_status <> 'paid' THEN
    RAISE EXCEPTION 'payment transaction not found for reversal';
  END IF;

  resolved_contact_id := existing_transaction.contact_id;

  IF resolved_contact_id IS NULL THEN
    SELECT array_agg(DISTINCT contacts.id ORDER BY contacts.id)
    INTO candidate_ids
    FROM public.contacts
    WHERE contacts.user_id = p_user_id
      AND (
        (normalized_document IS NOT NULL AND regexp_replace(coalesce(contacts.documento, ''), '[^0-9]', '', 'g') = normalized_document)
        OR (normalized_email IS NOT NULL AND lower(contacts.email) = normalized_email)
        OR (normalized_phone IS NOT NULL AND (
          regexp_replace(coalesce(contacts.phone, ''), '[^0-9]', '', 'g') = normalized_phone
          OR regexp_replace(coalesce(contacts.whatsapp, ''), '[^0-9]', '', 'g') = normalized_phone
        ))
      );

    IF cardinality(candidate_ids) > 1 THEN
      RAISE EXCEPTION 'ambiguous payment identity';
    END IF;

    resolved_contact_id := candidate_ids[1];
  END IF;

  IF resolved_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      user_id, name, email, phone, documento, origin, status, produto,
      amount, gateway, external_id
    )
    VALUES (
      p_user_id,
      coalesce(normalized_name, 'Cliente ' || right(normalized_external_id, 8)),
      normalized_email,
      normalized_phone,
      normalized_document,
      'compra',
      'Cliente',
      normalized_product,
      0,
      normalized_gateway,
      normalized_external_id
    )
    RETURNING id INTO resolved_contact_id;
  ELSE
    UPDATE public.contacts
    SET name = coalesce(name, normalized_name),
        email = coalesce(email, normalized_email),
        phone = coalesce(phone, normalized_phone),
        documento = coalesce(documento, normalized_document),
        origin = coalesce(origin, 'compra'),
        status = 'Cliente',
        produto = coalesce(normalized_product, produto),
        gateway = normalized_gateway,
        external_id = normalized_external_id,
        updated_at = now()
    WHERE id = resolved_contact_id
      AND user_id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment contact scope conflict';
    END IF;
  END IF;

  INSERT INTO public.payment_transactions (
    user_id, contact_id, gateway, external_id, status, product,
    currency, amount, refunded_amount, paid_at
  )
  VALUES (
    p_user_id, resolved_contact_id, normalized_gateway,
    normalized_external_id, normalized_status, normalized_product,
    normalized_currency, p_amount, p_refunded_amount,
    coalesce(p_paid_at, CASE WHEN normalized_status = 'paid' THEN now() END)
  )
  ON CONFLICT (user_id, gateway, external_id)
  DO UPDATE SET
    contact_id = coalesce(public.payment_transactions.contact_id, excluded.contact_id),
    status = CASE
      WHEN CASE public.payment_transactions.status
        WHEN 'paid' THEN 1 WHEN 'partially_refunded' THEN 2
        WHEN 'canceled' THEN 3 WHEN 'refunded' THEN 4 WHEN 'chargeback' THEN 4
      END
      > CASE excluded.status
        WHEN 'paid' THEN 1 WHEN 'partially_refunded' THEN 2
        WHEN 'canceled' THEN 3 WHEN 'refunded' THEN 4 WHEN 'chargeback' THEN 4
      END
      THEN public.payment_transactions.status
      ELSE excluded.status
    END,
    product = coalesce(excluded.product, public.payment_transactions.product),
    currency = excluded.currency,
    amount = greatest(public.payment_transactions.amount, excluded.amount),
    refunded_amount = greatest(public.payment_transactions.refunded_amount, excluded.refunded_amount),
    paid_at = coalesce(public.payment_transactions.paid_at, excluded.paid_at)
  RETURNING id, (xmax = 0)
  INTO transaction_id, transaction_created;

  UPDATE public.contacts
  SET amount = coalesce((
        SELECT sum(payment_transactions.net_amount)
        FROM public.payment_transactions
        WHERE payment_transactions.user_id = p_user_id
          AND payment_transactions.contact_id = resolved_contact_id
          AND payment_transactions.status NOT IN ('canceled', 'chargeback')
      ), 0),
      updated_at = now()
  WHERE id = resolved_contact_id
    AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', transaction_id,
    'contact_id', resolved_contact_id,
    'created', transaction_created
  );
END
$function$;

REVOKE ALL ON FUNCTION public.touch_payment_transaction_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_payment_transaction(
  uuid, text, text, text, numeric, numeric, text, text,
  timestamptz, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_payment_transaction(
  uuid, text, text, text, numeric, numeric, text, text,
  timestamptz, text, text, text, text
) TO service_role;
