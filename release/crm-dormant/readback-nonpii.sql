-- Read-only, aggregate/metadata only. Parent executes after each explicitly authorized apply.
BEGIN READ ONLY;
SELECT version,name FROM supabase_migrations.schema_migrations
 WHERE version >= '20261102203246' ORDER BY version;
SELECT enabled,wait_seconds FROM crm_campaign_private.dispatch_control WHERE singleton;
SELECT count(*) AS contacts FROM public.contacts;
SELECT count(*) AS messages FROM public.email_messages;
SELECT count(*) AS campaigns FROM public.email_campaigns;
SELECT count(*) AS batches FROM public.email_campaign_batches;
SELECT count(*) AS outbox_entries FROM crm_campaign_private.dispatch_outbox;
SELECT n.nspname,c.relname,c.relrowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crm_campaign_private' AND c.relname IN('dispatch_control','dispatch_outbox');
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef,p.proconfig,p.proacl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='crm_campaign_private' AND p.proname IN('dispatch_reason','second_reason','legacy_second_policy','guard_legacy_draft','freeze_second'))
 OR (n.nspname='public' AND p.proname IN('review_email_campaign_followup','claim_campaign_dispatch','claim_campaign_second_dispatch','start_campaign_dispatch','finish_campaign_dispatch','release_campaign_dispatch','publish_campaign_second_dispatch','list_campaign_second_work','review_campaign_legacy_second','prepare_campaign_legacy_second','approve_campaign_legacy_second','approve_campaign_second_step','get_campaign_legacy_second'))
 ORDER BY n.nspname,p.proname;
SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgname IN('guard_email_message_binding','freeze_second_approval','freeze_second_message','guard_legacy_draft')
 ORDER BY c.relname,t.tgname;
SELECT crm_campaign_private.legacy_second_policy() AS approved_public_copy;
COMMIT;
-- No row identifiers, addresses, message bodies, provider receipts, or customer records.
