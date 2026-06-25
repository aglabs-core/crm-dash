-- =============================================================================
-- Professional upgrade
-- - Reconciles schema drift (columns created manually, never migrated)
-- - Adds honest analytics fields (closed_at, lost_reason, deal-level produto)
-- - Adds the activities timeline (contact 360) with RLS + realtime
-- - Normalizes taxonomy and enforces it with CHECK constraints
-- - Adds performance indexes
--
-- Idempotent: safe to run on the existing (drifted) database. All data is
-- normalized BEFORE constraints/triggers are created so nothing fails or
-- fires spuriously.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reconcile schema drift (these columns exist in the live DB but were
--    never captured in a migration; recreating the DB from migrations alone
--    would otherwise break the app).
--    NOTE: deals.contact_id is already covered by 20260317151100.
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS produto TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lp_url  TEXT;

ALTER TABLE deals    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Média';

ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. New columns for honest analytics
-- ---------------------------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS produto     TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at   TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Backfill product onto deals from the linked contact (product now lives on the deal)
UPDATE deals d
SET produto = c.produto
FROM contacts c
WHERE d.contact_id = c.id
  AND (d.produto IS NULL OR d.produto = '')
  AND c.produto IS NOT NULL AND c.produto <> '';

-- Backfill closed_at for deals already won/lost so historical revenue is attributed
UPDATE deals
SET closed_at = COALESCE(updated_at, created_at)
WHERE stage IN ('Ganho', 'Perdido') AND closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Normalize data, THEN enforce taxonomy with CHECK constraints.
--    Catch-all mappings guarantee no row can violate the constraints.
-- ---------------------------------------------------------------------------

-- deals.stage
UPDATE deals SET stage = 'Lead'
WHERE stage IS NULL
   OR stage NOT IN ('Lead','Contatado','Proposta','Negociação','Ganho','Perdido');

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE deals ADD  CONSTRAINT deals_stage_check
  CHECK (stage IN ('Lead','Contatado','Proposta','Negociação','Ganho','Perdido'));

-- deals.priority (map legacy/english values to PT, everything else -> Média)
UPDATE deals SET priority = CASE lower(COALESCE(priority,''))
    WHEN 'high'  THEN 'Alta'
    WHEN 'alta'  THEN 'Alta'
    WHEN 'low'   THEN 'Baixa'
    WHEN 'baixa' THEN 'Baixa'
    ELSE 'Média'
  END
WHERE priority IS NULL OR priority NOT IN ('Baixa','Média','Alta');

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_priority_check;
ALTER TABLE deals ADD  CONSTRAINT deals_priority_check
  CHECK (priority IN ('Baixa','Média','Alta'));

-- tasks.priority
UPDATE tasks SET priority = CASE lower(COALESCE(priority,''))
    WHEN 'high'  THEN 'Alta'
    WHEN 'alta'  THEN 'Alta'
    WHEN 'low'   THEN 'Baixa'
    WHEN 'baixa' THEN 'Baixa'
    ELSE 'Média'
  END
WHERE priority IS NULL OR priority NOT IN ('Baixa','Média','Alta');

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD  CONSTRAINT tasks_priority_check
  CHECK (priority IN ('Baixa','Média','Alta'));

-- tasks.status
UPDATE tasks SET status = 'pending'
WHERE status IS NULL OR status NOT IN ('pending','completed');

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD  CONSTRAINT tasks_status_check
  CHECK (status IN ('pending','completed'));

-- contacts.status
UPDATE contacts SET status = 'Lead'
WHERE status IS NULL
   OR status NOT IN ('Lead','Contatado','Proposta','Negociação','Ganho','Cliente','Inativo');

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_status_check
  CHECK (status IN ('Lead','Contatado','Proposta','Negociação','Ganho','Cliente','Inativo'));

-- ---------------------------------------------------------------------------
-- 4. Activities table (contact 360 timeline)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activities (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES contacts(id)   ON DELETE CASCADE,
  deal_id    UUID REFERENCES deals(id)      ON DELETE SET NULL,
  type       TEXT NOT NULL DEFAULT 'note',
  content    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own activities" ON activities;
CREATE POLICY "Users can manage their own activities"
ON activities FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD  CONSTRAINT activities_type_check
  CHECK (type IN ('note','call','email','meeting','stage_change','task'));

-- Expose activities to Supabase realtime (guarded: ignore if already added / no publication)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activities;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Triggers: keep closed_at honest and log stage changes to the timeline.
--    Created AFTER all data normalization above so they don't fire spuriously.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_deal_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IN ('Ganho','Perdido') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    ELSIF OLD.stage IS DISTINCT FROM NEW.stage THEN
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_deal_closed_at ON deals;
CREATE TRIGGER trg_set_deal_closed_at
BEFORE INSERT OR UPDATE ON deals
FOR EACH ROW EXECUTE PROCEDURE set_deal_closed_at();

CREATE OR REPLACE FUNCTION log_deal_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO activities (user_id, contact_id, deal_id, type, content)
    VALUES (
      NEW.user_id,
      NEW.contact_id,
      NEW.id,
      'stage_change',
      'Estágio de "' || COALESCE(NEW.title,'negócio') || '" alterado: ' ||
      COALESCE(OLD.stage,'—') || ' → ' || COALESCE(NEW.stage,'—')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_deal_stage_change ON deals;
CREATE TRIGGER trg_log_deal_stage_change
AFTER UPDATE ON deals
FOR EACH ROW EXECUTE PROCEDURE log_deal_stage_change();

-- ---------------------------------------------------------------------------
-- 6. Performance indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_deals_user_stage        ON deals(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_user_closed_at     ON deals(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_deals_contact            ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due    ON tasks(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_contact            ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user_status     ON contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_activities_contact_created ON activities(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_user_created    ON activities(user_id, created_at DESC);
