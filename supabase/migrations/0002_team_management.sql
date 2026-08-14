-- Echo billing system — signup bootstrap + team management support
--
-- Enables the one-time "first signup creates the organization" flow and
-- backs Settings > Team. All admin_users/organizations writes for this
-- flow go through edge functions using the service-role client with their
-- own explicit checks (see supabase/functions/org-bootstrap,
-- admin-add-user, admin-update-role, admin-remove-user) rather than new
-- RLS policies, because listing teammates needs their email from
-- auth.users, which RLS can't expose to the client regardless.

-- ---------------------------------------------------------------------------
-- bootstrap_organization — called once, by the very first signup. Creates
-- the single organizations row and its owner admin_users row atomically.
-- The table lock serializes concurrent first-signup attempts so exactly one
-- of them wins the "does an org already exist" check.
-- ---------------------------------------------------------------------------
create or replace function bootstrap_organization(p_org_name text, p_owner_id uuid, p_owner_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  lock table organizations in share row exclusive mode;

  if exists (select 1 from organizations) then
    raise exception 'organization_exists';
  end if;

  insert into organizations (name)
  values (coalesce(nullif(trim(p_org_name), ''), 'Echo'))
  returning id into v_org_id;

  insert into admin_users (id, org_id, full_name, role)
  values (p_owner_id, v_org_id, nullif(trim(p_owner_full_name), ''), 'owner');

  return v_org_id;
end;
$$;

-- Only callable from edge functions via the service-role key, never
-- directly from a browser (anon/authenticated) client.
revoke all on function bootstrap_organization(text, uuid, text) from public, anon, authenticated;
