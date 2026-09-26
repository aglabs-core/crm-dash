-- A 30-minute created_at window can lose task alerts during n8n downtime.
-- The receipt lets the sender retry all unacknowledged pending tasks.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS antonio_alerted_at timestamptz;

COMMENT ON COLUMN public.tasks.antonio_alerted_at IS
  'Set only after the Antonio WhatsApp alert succeeds; NULL tasks remain eligible for retry.';

-- Historical pending tasks may already have been announced by the old flow.
-- Keep the first run after rollout from sending a backlog of duplicate alerts.
UPDATE public.tasks
SET antonio_alerted_at = now()
WHERE assigned_to = 'antonio'
  AND status = 'pending'
  AND antonio_alerted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_antonio_unalerted
  ON public.tasks (created_at, id)
  WHERE assigned_to = 'antonio'
    AND status = 'pending'
    AND antonio_alerted_at IS NULL;
