-- =============================================================================
-- Self-service account deletion
--
-- The client can't call the admin API (that needs the service_role key), so we
-- expose a SECURITY DEFINER function that deletes the *calling* user from
-- auth.users. Every user-owned table (contacts, deals, tasks, activities)
-- references auth.users(id) ON DELETE CASCADE, so their data is removed with it.
-- leads_institucional is a shared inbox (no user_id) and is intentionally kept.
--
-- Idempotent; safe to re-run.
-- =============================================================================

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Best-effort cleanup of the user's storage rows (avatar). Wrapped so a
  -- permissions hiccup never blocks the account deletion itself.
  begin
    delete from storage.objects where bucket_id = 'crm-dash' and owner = uid;
  exception when others then
    null;
  end;

  -- Cascades remove the user's contacts / deals / tasks / activities.
  delete from auth.users where id = uid;
end;
$$;

-- Only signed-in users may delete their own account.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
