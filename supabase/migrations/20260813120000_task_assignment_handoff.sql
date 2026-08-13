-- =============================================================================
-- Atribuição estruturada de tarefas para handoffs operacionais
--
-- A Maia registra a pendência no CRM e pode avisar o Léo no Discord, mas o
-- Discord não é a fonte de verdade. Sem um campo de responsável, o handoff
-- dependia do texto da tarefa e não podia ser filtrado ou automatizado.
--
-- Os identificadores são papéis operacionais estáveis, não IDs de login. Isso
-- permite que n8n/Hermes criem tarefas sem conhecer auth.users e mantém o
-- histórico quando a conta de acesso muda.
-- =============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to TEXT;

UPDATE tasks
SET assigned_to = CASE
  WHEN lower(title || ' ' || COALESCE(description, '')) ~ '(^|[^a-z])l[ée]o([^a-z]|$)' THEN 'leo'
  WHEN lower(title || ' ' || COALESCE(description, '')) ~ '(^|[^a-z])maia([^a-z]|$)' THEN 'maia'
  WHEN lower(title || ' ' || COALESCE(description, '')) ~ '(^|[^a-z])antonio([^a-z]|$)' THEN 'antonio'
  WHEN lower(title || ' ' || COALESCE(description, '')) ~ 't[ée]cnic' THEN 'tecnico'
  ELSE assigned_to
END
WHERE assigned_to IS NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_to_check
  CHECK (assigned_to IS NULL OR assigned_to IN ('maia', 'leo', 'antonio', 'tecnico'));

CREATE INDEX IF NOT EXISTS idx_tasks_user_assigned_status_due
  ON tasks(user_id, assigned_to, status, due_date);

COMMENT ON COLUMN tasks.assigned_to IS
  'Papel operacional responsável: maia, leo, antonio ou tecnico. NULL significa sem atribuição.';
