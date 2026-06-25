-- =============================================================================
-- Leads (inbound) · Clients · Deal archiving
--
-- Information-architecture upgrade. Three goals:
--   1. Archiving: deals can be archived so dead/old leads leave the Kanban and
--      stop polluting analytics — without losing the record (reversible).
--   2. Institutional leads: the web-capture table (leads_institucional) becomes
--      a first-class inbound "leads database", with a handling status and a link
--      to the contact it gets converted into.
--   3. Clients: no schema needed — a client is a contact with a won deal (or
--      status Cliente/Ganho); the app derives it. This migration just makes the
--      data feeding that view honest.
--
-- Idempotent and safe to re-run. Data is normalized BEFORE constraints fire.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Deal archiving
-- ---------------------------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: the Kanban/analytics only ever query the active board.
CREATE INDEX IF NOT EXISTS idx_deals_user_active
  ON deals(user_id, stage)
  WHERE archived = FALSE;

-- ---------------------------------------------------------------------------
-- 2. Institutional (inbound) leads — handling workflow
--    Existing columns: id, lead (name), email, whatsapp, created_at.
--    Add: status, produto, contact_id (set on conversion), notes.
-- ---------------------------------------------------------------------------
ALTER TABLE leads_institucional ADD COLUMN IF NOT EXISTS status     TEXT DEFAULT 'novo';
ALTER TABLE leads_institucional ADD COLUMN IF NOT EXISTS produto    TEXT;
ALTER TABLE leads_institucional ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE leads_institucional ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- Normalize, then enforce the handling taxonomy.
UPDATE leads_institucional SET status = 'novo'
WHERE status IS NULL OR status NOT IN ('novo','contatado','convertido','descartado');

ALTER TABLE leads_institucional DROP CONSTRAINT IF EXISTS leads_institucional_status_check;
ALTER TABLE leads_institucional ADD  CONSTRAINT leads_institucional_status_check
  CHECK (status IN ('novo','contatado','convertido','descartado'));

CREATE INDEX IF NOT EXISTS idx_leads_inst_status ON leads_institucional(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS for institutional leads.
--    The public web form inserts as `anon`; the CRM owner (authenticated) must
--    be able to read, qualify and convert them. These policies are PERMISSIVE
--    (OR-ed with any existing ones) so re-running can't lock anyone out.
--    leads_institucional has no user_id — it's a single, shared inbound inbox.
-- ---------------------------------------------------------------------------
ALTER TABLE leads_institucional ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can submit institutional leads" ON leads_institucional;
CREATE POLICY "Public can submit institutional leads"
  ON leads_institucional FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read institutional leads" ON leads_institucional;
CREATE POLICY "Authenticated can read institutional leads"
  ON leads_institucional FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can update institutional leads" ON leads_institucional;
CREATE POLICY "Authenticated can update institutional leads"
  ON leads_institucional FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete institutional leads" ON leads_institucional;
CREATE POLICY "Authenticated can delete institutional leads"
  ON leads_institucional FOR DELETE TO authenticated USING (true);

-- Live updates on the Leads page (guarded: ignore if already added / no publication).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE leads_institucional;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
