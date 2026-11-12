-- Current contact statuses cannot prove historical conversion or time spent in a stage.
-- Capture future transitions explicitly. Never fabricate a backfill for earlier contacts.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.crm_journey_coverage (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_journey_coverage(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.contact_stage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  previous_status text,
  next_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS contact_stage_events_contact_time_idx ON public.contact_stage_events(contact_id,changed_at,id);
ALTER TABLE public.contact_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visible_contact ON public.contact_stage_events;
CREATE POLICY visible_contact ON public.contact_stage_events FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=contact_stage_events.contact_id)
);
REVOKE ALL ON public.contact_stage_events,public.crm_journey_coverage FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.contact_stage_events,public.crm_journey_coverage TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_contact_stage_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.contact_stage_events(contact_id,user_id,previous_status,next_status) VALUES(NEW.id,NEW.user_id,NULL,NEW.status);
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.contact_stage_events(contact_id,user_id,previous_status,next_status) VALUES(NEW.id,NEW.user_id,OLD.status,NEW.status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_contact_stage_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_record_contact_stage_event ON public.contacts;
CREATE TRIGGER trg_record_contact_stage_event AFTER INSERT OR UPDATE OF status ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.record_contact_stage_event();

CREATE OR REPLACE FUNCTION public.crm_journey_report(p_product text DEFAULT NULL,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_days IS NULL OR p_days NOT IN(30,90,365) OR length(p_product)>160 THEN RAISE EXCEPTION 'Invalid journey window'; END IF;
  WITH coverage AS (SELECT started_at,greatest(started_at,now()-make_interval(days=>p_days)) AS since FROM public.crm_journey_coverage),
  cohort AS MATERIALIZED (
    SELECT e.contact_id,min(e.changed_at) AS entered_at FROM public.contact_stage_events e JOIN public.contacts c ON c.id=e.contact_id
    WHERE e.previous_status IS NULL AND e.next_status='Lead' AND c.prospecting_pool IS NOT TRUE
      AND (p_product IS NULL OR nullif(btrim(c.produto),'')=p_product)
      AND e.changed_at>=(SELECT since FROM coverage) AND e.changed_at<=now() GROUP BY e.contact_id
  ),
  wins AS (SELECT co.contact_id,min(e.changed_at) AS won_at,co.entered_at FROM cohort co JOIN public.contact_stage_events e ON e.contact_id=co.contact_id
    WHERE e.next_status='Cliente' AND e.changed_at>=co.entered_at AND e.changed_at<=now() GROUP BY co.contact_id,co.entered_at),
  intervals AS (SELECT e.next_status,e.changed_at,lead(e.changed_at) OVER(PARTITION BY e.contact_id ORDER BY e.changed_at,e.id) AS exited_at
    FROM public.contact_stage_events e JOIN cohort co ON co.contact_id=e.contact_id WHERE e.changed_at<=now()),
  stage_times AS (SELECT next_status AS stage,count(*) AS completedIntervals,avg(extract(epoch FROM(exited_at-changed_at))/86400) AS averageDays
    FROM intervals WHERE exited_at IS NOT NULL GROUP BY next_status)
  SELECT jsonb_build_object('trackedSince',(SELECT started_at FROM coverage),'cohortSince',(SELECT since FROM coverage),'days',p_days,
    'leads',(SELECT count(*) FROM cohort),'converted',(SELECT count(*) FROM wins),
    'conversionRate',(SELECT 100.0*(SELECT count(*) FROM wins)/nullif(count(*),0) FROM cohort),
    'averageDaysToCustomer',(SELECT avg(extract(epoch FROM(won_at-entered_at))/86400) FROM wins),
    'completedStageTimes',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM stage_times s)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_journey_report(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_journey_report(text,integer) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
