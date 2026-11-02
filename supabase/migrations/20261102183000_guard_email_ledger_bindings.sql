-- The ledger deliberately belongs to Maia's technical tenant; admin-owned
-- contacts/campaigns retain their owner. Equality of all user_id fields is NOT
-- this contract. Prevent unrelated campaign/recipient links without rewriting
-- historical rows, changing RLS, transferring contacts, or sending anything.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION crm_ledger_private.guard_message_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.contacts; campaign public.email_campaigns; recipient public.email_campaign_recipients;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.user_id, NEW.contact_id, NEW.address, NEW.campaign_id, NEW.recipient_id, NEW.product)
      IS NOT DISTINCT FROM (OLD.user_id, OLD.contact_id, OLD.address, OLD.campaign_id, OLD.recipient_id, OLD.product)
      THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO c FROM public.contacts WHERE id = NEW.contact_id FOR SHARE;
  IF c.id IS NULL OR NOT crm_ledger_private.contact_owner(c.user_id)
    OR NEW.user_id IS DISTINCT FROM crm_ledger_private.tenant()
    OR lower(btrim(c.email)) IS DISTINCT FROM NEW.address
    THEN RAISE EXCEPTION 'ledger/contact binding conflict'; END IF;
  IF NEW.campaign_id IS NOT NULL THEN
    SELECT * INTO campaign FROM public.email_campaigns WHERE id = NEW.campaign_id FOR SHARE;
    IF campaign.id IS NULL OR campaign.user_id IS DISTINCT FROM c.user_id
      OR public.campaign_product_key(campaign.product) IS DISTINCT FROM public.campaign_product_key(NEW.product)
      THEN RAISE EXCEPTION 'campaign/contact binding conflict'; END IF;
  END IF;
  IF NEW.recipient_id IS NOT NULL THEN
    SELECT * INTO recipient FROM public.email_campaign_recipients WHERE id = NEW.recipient_id FOR SHARE;
    IF recipient.id IS NULL OR NEW.campaign_id IS NULL
      OR recipient.campaign_id IS DISTINCT FROM NEW.campaign_id OR recipient.user_id IS DISTINCT FROM c.user_id
      OR recipient.contact_id IS DISTINCT FROM c.id OR lower(btrim(recipient.email_snapshot)) IS DISTINCT FROM NEW.address
      THEN RAISE EXCEPTION 'recipient/campaign binding conflict'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_ledger_private.guard_message_binding() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS guard_email_message_binding ON public.email_messages;
CREATE TRIGGER guard_email_message_binding BEFORE INSERT OR UPDATE OF user_id,contact_id,address,campaign_id,recipient_id,product
  ON public.email_messages FOR EACH ROW EXECUTE FUNCTION crm_ledger_private.guard_message_binding();
COMMIT;
