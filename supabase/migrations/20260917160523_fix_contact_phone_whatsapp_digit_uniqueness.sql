-- Correct digits-only uniqueness; do not rewrite or merge contacts.
-- Rebuild both indexes atomically. Existing normalized duplicates abort and
-- roll back the transaction: resolve identity conflicts explicitly, never by
-- silently discarding contacts. Reapplying succeeds when the indexes exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.contacts IN SHARE MODE;
DROP INDEX public.uq_contacts_user_phone;
CREATE UNIQUE INDEX uq_contacts_user_phone ON public.contacts
(user_id, regexp_replace(phone, '[^0-9]', '', 'g'))
WHERE phone IS NOT NULL AND phone <> '';
DROP INDEX public.uq_contacts_user_whatsapp;
CREATE UNIQUE INDEX uq_contacts_user_whatsapp ON public.contacts
(user_id, regexp_replace(whatsapp::text, '[^0-9]', '', 'g'))
WHERE whatsapp IS NOT NULL AND whatsapp::text <> '';
COMMIT;
