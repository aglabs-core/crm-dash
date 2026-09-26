-- Produto is the identified offer, not the relationship stage. Reconcile
-- historical aliases while retaining the same contact and its activity trail.
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_prospecting_pool_status_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_prospecting_pool_status_check
  CHECK (NOT prospecting_pool OR status = 'Arquivado');

UPDATE public.contacts
SET produto = 'barberias'
WHERE lower(btrim(produto)) IN ('barberpro', 'barber pro');

UPDATE public.contacts AS c
SET produto = NULL
WHERE lower(btrim(c.produto)) IN (
  'interesse geral',
  'interesse geral nos serviços da ag labs',
  'atendimento geral'
)
AND NOT EXISTS (
  SELECT 1 FROM public.payment_transactions AS p WHERE p.contact_id = c.id
);

CREATE OR REPLACE FUNCTION public.normalize_contact_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF lower(btrim(NEW.produto)) IN ('barberpro', 'barber pro') THEN
    NEW.produto := 'barberias';
  ELSIF lower(btrim(NEW.produto)) IN (
    'interesse geral',
    'interesse geral nos serviços da ag labs',
    'atendimento geral'
  ) THEN
    NEW.produto := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_contact_product ON public.contacts;
CREATE TRIGGER trg_normalize_contact_product
BEFORE INSERT OR UPDATE OF produto ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.normalize_contact_product();
