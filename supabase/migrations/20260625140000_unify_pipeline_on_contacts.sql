-- =============================================================================
-- Unify the sales pipeline on `contacts` (contact-centric model)
--
-- Problem this fixes: the funnel lived in TWO overlapping places —
-- `contacts.status` and `deals.stage`. Agents wrote to both, so they drifted
-- ("the client isn't being moved"). With one flow per contact, the funnel
-- belongs to the contact as a single attribute.
--
-- After this migration:
--   • contacts.status is the ONE lifecycle field:
--       Lead · Contatado · Proposta · Negociação   (in the Kanban)
--       Cliente                                     (won, active client)
--       Inativo                                     (won, inactive client)
--       Arquivado                                   (didn't close — out of Kanban)
--   • contacts carries the deal economics (amount, expected_close_date,
--     closed_at, lost_reason, priority) and an `origin` (web/prospeccao/whatsapp).
--   • `deals` is dropped (the DB is new — no backup needed).
--   • a unique key blocks duplicate people from multiple agent sources.
--
-- Idempotent; normalizes data before constraints/triggers. DESTRUCTIVE: drops
-- the `deals` table at the end (its data is migrated onto contacts first).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pipeline fields on contacts
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS origin              TEXT DEFAULT 'prospeccao';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS amount              NUMERIC(15,2) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS expected_close_date DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS closed_at           TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lost_reason         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS priority            TEXT DEFAULT 'Média';

-- ---------------------------------------------------------------------------
-- 2. Backfill economics + funnel position from each contact's deal.
--    One flow per contact; if legacy data has several, take the latest.
--    Deal stage wins over contact.status (deals tracked the real interactions).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deals') THEN
    WITH ranked AS (
      SELECT DISTINCT ON (contact_id)
        contact_id, stage, amount, expected_close_date, closed_at, lost_reason, priority
      FROM deals
      WHERE contact_id IS NOT NULL
      ORDER BY contact_id, updated_at DESC NULLS LAST, created_at DESC
    )
    UPDATE contacts c
    SET amount              = COALESCE(r.amount, c.amount),
        expected_close_date = r.expected_close_date,
        closed_at           = r.closed_at,
        lost_reason         = r.lost_reason,
        priority            = COALESCE(r.priority, 'Média'),
        status              = CASE r.stage
                                WHEN 'Ganho'   THEN 'Cliente'
                                WHEN 'Perdido' THEN 'Arquivado'
                                ELSE r.stage
                              END
    FROM ranked r
    WHERE c.id = r.contact_id;

    -- Orphan deals (no contact) become contacts so nothing is lost.
    INSERT INTO contacts
      (user_id, name, company, produto, status, amount, expected_close_date, closed_at, lost_reason, priority, origin)
    SELECT user_id, COALESCE(NULLIF(title, ''), 'Sem nome'), company, produto,
           CASE stage WHEN 'Ganho' THEN 'Cliente' WHEN 'Perdido' THEN 'Arquivado' ELSE stage END,
           amount, expected_close_date, closed_at, lost_reason, COALESCE(priority, 'Média'), 'prospeccao'
    FROM deals
    WHERE contact_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Migrate the legacy status vocabulary to the new one.
--    'Ganho' -> 'Cliente'; 'Inativo' (dead leads, incl. the 61 archived) ->
--    'Arquivado'. (New DB has no real inactive clients yet, so this is safe.)
-- ---------------------------------------------------------------------------
UPDATE contacts SET status = 'Cliente'   WHERE status = 'Ganho';
UPDATE contacts SET status = 'Arquivado' WHERE status = 'Inativo';

-- Origin: web when it came from a landing page or an institutional lead.
UPDATE contacts SET origin = 'web'
WHERE (lp_url IS NOT NULL AND lp_url <> '')
   OR id IN (SELECT contact_id FROM leads_institucional WHERE contact_id IS NOT NULL);
UPDATE contacts SET origin = 'prospeccao' WHERE origin IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Normalize + constrain the new taxonomy
-- ---------------------------------------------------------------------------
UPDATE contacts SET status = 'Lead'
WHERE status IS NULL
   OR status NOT IN ('Lead','Contatado','Proposta','Negociação','Cliente','Inativo','Arquivado');
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_status_check
  CHECK (status IN ('Lead','Contatado','Proposta','Negociação','Cliente','Inativo','Arquivado'));

UPDATE contacts SET origin = 'prospeccao' WHERE origin NOT IN ('web','prospeccao','whatsapp','manual');
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_origin_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_origin_check
  CHECK (origin IN ('web','prospeccao','whatsapp','manual'));

UPDATE contacts SET priority = CASE lower(COALESCE(priority,''))
    WHEN 'high' THEN 'Alta' WHEN 'alta' THEN 'Alta'
    WHEN 'low'  THEN 'Baixa' WHEN 'baixa' THEN 'Baixa'
    ELSE 'Média' END
WHERE priority IS NULL OR priority NOT IN ('Baixa','Média','Alta');
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_priority_check;
ALTER TABLE contacts ADD  CONSTRAINT contacts_priority_check
  CHECK (priority IN ('Baixa','Média','Alta'));

-- ---------------------------------------------------------------------------
-- 5. Deduplicate people (same phone/email from multiple agent sources),
--    keeping the most-advanced record, then guard against future duplicates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  -- collapse by normalized phone, then by lower(email) for those without phone
  FOR r IN
    SELECT array_agg(id ORDER BY
             (CASE status
                WHEN 'Cliente' THEN 6 WHEN 'Inativo' THEN 5 WHEN 'Negociação' THEN 4
                WHEN 'Proposta' THEN 3 WHEN 'Contatado' THEN 2 WHEN 'Lead' THEN 1 ELSE 0 END) DESC,
             updated_at DESC NULLS LAST) AS ids
    FROM contacts
    WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY user_id, regexp_replace(phone, '\D', '', 'g')
    HAVING count(*) > 1
  LOOP
    UPDATE tasks               SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    UPDATE activities          SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    UPDATE leads_institucional SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    DELETE FROM contacts WHERE id = ANY(r.ids[2:array_length(r.ids,1)]);
  END LOOP;

  FOR r IN
    SELECT array_agg(id ORDER BY
             (CASE status
                WHEN 'Cliente' THEN 6 WHEN 'Inativo' THEN 5 WHEN 'Negociação' THEN 4
                WHEN 'Proposta' THEN 3 WHEN 'Contatado' THEN 2 WHEN 'Lead' THEN 1 ELSE 0 END) DESC,
             updated_at DESC NULLS LAST) AS ids
    FROM contacts
    WHERE (phone IS NULL OR phone = '') AND email IS NOT NULL AND email <> ''
    GROUP BY user_id, lower(email)
    HAVING count(*) > 1
  LOOP
    UPDATE tasks               SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    UPDATE activities          SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    UPDATE leads_institucional SET contact_id = r.ids[1] WHERE contact_id = ANY(r.ids[2:array_length(r.ids,1)]);
    DELETE FROM contacts WHERE id = ANY(r.ids[2:array_length(r.ids,1)]);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_user_phone
  ON contacts(user_id, regexp_replace(phone, '\D', '', 'g'))
  WHERE phone IS NOT NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_user_email
  ON contacts(user_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- ---------------------------------------------------------------------------
-- 6. Triggers on contacts: keep closed_at honest + log status changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_contact_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('Cliente','Inativo','Arquivado') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_contact_closed_at ON contacts;
CREATE TRIGGER trg_set_contact_closed_at
BEFORE INSERT OR UPDATE ON contacts
FOR EACH ROW EXECUTE PROCEDURE set_contact_closed_at();

CREATE OR REPLACE FUNCTION log_contact_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO activities (user_id, contact_id, type, content)
    VALUES (NEW.user_id, NEW.id, 'stage_change',
      'Status de "' || COALESCE(NEW.name,'contato') || '" alterado: ' ||
      COALESCE(OLD.status,'—') || ' → ' || COALESCE(NEW.status,'—'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_contact_status_change ON contacts;
CREATE TRIGGER trg_log_contact_status_change
AFTER UPDATE ON contacts
FOR EACH ROW EXECUTE PROCEDURE log_contact_status_change();

-- ---------------------------------------------------------------------------
-- 7. Decouple activities from deals, then drop the deals table.
-- ---------------------------------------------------------------------------
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_deal_id_fkey;
ALTER TABLE activities DROP COLUMN     IF EXISTS deal_id;

DROP TRIGGER IF EXISTS trg_set_deal_closed_at      ON deals;
DROP TRIGGER IF EXISTS trg_log_deal_stage_change   ON deals;
DROP TABLE   IF EXISTS deals CASCADE;

-- ---------------------------------------------------------------------------
-- 8. Indexes for the contact-as-pipeline queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contacts_user_status ON contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_user_closed ON contacts(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_contacts_user_origin ON contacts(user_id, origin);
