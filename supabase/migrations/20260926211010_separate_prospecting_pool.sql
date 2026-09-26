-- Cold outreach contacts were archived as lost deals. This mixed a campaign
-- list with qualified opportunities and inflated funnel and loss metrics.
-- Keep the contact history in one table while marking the list explicitly.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS prospecting_pool boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contacts.prospecting_pool IS
  'Cold outreach list, outside the sales funnel until the contact engages.';

-- Antonio confirmed these 72 historical LocalSite contacts were sourced for
-- outreach, not inbound web leads. Their former demo pages are discontinued.
-- The original lp_url remains as history, but the CRM must not advertise it.
UPDATE public.contacts AS c
SET prospecting_pool = true,
    origin = 'prospeccao'
WHERE c.produto = 'localsite'
  AND c.status = 'Arquivado'
  AND c.origin IN ('web', 'prospeccao')
  AND c.created_at < '2026-07-08'::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions AS p
    WHERE p.contact_id = c.id
  );

CREATE OR REPLACE FUNCTION public.clear_prospecting_pool_on_engagement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NEW.prospecting_pool
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status <> 'Arquivado'
  THEN
    NEW.prospecting_pool := false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_prospecting_pool_on_engagement ON public.contacts;
CREATE TRIGGER trg_clear_prospecting_pool_on_engagement
BEFORE UPDATE OF status ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.clear_prospecting_pool_on_engagement();
