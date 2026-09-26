-- A prospecting list is not automatically an outbound campaign. Keep every
-- contact unreviewed until its channel and context have been checked. Explicit
-- no-contact requests survive later changes to funnel stage or product.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'unreviewed';

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_outreach_status_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_outreach_status_check
  CHECK (outreach_status IN ('unreviewed', 'contactable', 'blocked'));

COMMENT ON COLUMN public.contacts.outreach_status IS
  'Outbound campaign review: unreviewed by default; contactable only after manual channel/context review; blocked means no marketing outreach.';

CREATE INDEX IF NOT EXISTS idx_contacts_prospecting_outreach_queue
  ON public.contacts (user_id, created_at, id)
  WHERE prospecting_pool AND outreach_status = 'contactable';
