-- Echo billing system — financial ledger (refunds), notifications, and
-- PPPoE account creation (previously nothing created the first account).
--
-- Idempotent throughout — safe to re-run from the top after a partial
-- failure (IF NOT EXISTS / IF EXISTS / CREATE OR REPLACE everywhere; the
-- two spots Postgres has no such clause for — ADD CONSTRAINT and ALTER
-- PUBLICATION ... ADD TABLE — are guarded with DROP IF EXISTS first or a
-- DO block that swallows the "already there" error).

-- ---------------------------------------------------------------------------
-- transactions — refund support, for "accounting to the last cent"
-- ---------------------------------------------------------------------------
alter table transactions
  add column if not exists refund_reason   text,
  add column if not exists refunded_amount numeric(10, 2),
  add column if not exists refunded_at     timestamptz;

alter table transactions drop constraint if exists transactions_status_check;
alter table transactions add constraint transactions_status_check
  check (status in ('pending', 'completed', 'failed', 'cancelled', 'refunded'));

-- ---------------------------------------------------------------------------
-- notifications — org-wide feed (payment events, device status changes).
-- Read state is shared across the org's admins for now, not per-admin —
-- simplest thing that works for a small team; revisit if that ever chafes.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  type          text not null check (type in (
                  'payment_completed', 'payment_failed', 'payment_refunded',
                  'device_linked', 'device_offline', 'device_error',
                  'voucher_low'
                )),
  severity      text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title         text not null,
  body          text,
  related_table text,
  related_id    uuid,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_org_id_created_idx on notifications(org_id, created_at desc);
create index if not exists notifications_org_id_unread_idx on notifications(org_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "org member read" on notifications;
create policy "org member read" on notifications for select
  using (org_id = current_org_id());
drop policy if exists "org member mark read" on notifications;
create policy "org member mark read" on notifications for update
  using (org_id = current_org_id()) with check (org_id = current_org_id());

do $$
begin
  alter publication supabase_realtime add table notifications;
exception when others then
  raise notice 'notifications already in supabase_realtime publication, skipping (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Notification-generating triggers — centralized here rather than scattered
-- across edge functions, so a notification fires no matter which code path
-- (webhook, client poll reconcile, admin action) caused the status change.
-- ---------------------------------------------------------------------------
create or replace function notify_on_transaction_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_name text;
begin
  if new.status = old.status then
    return new;
  end if;

  select name into v_plan_name from plans where id = new.plan_id;

  if new.status = 'completed' then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (
      new.org_id, 'payment_completed', 'info',
      'Payment received',
      coalesce(v_plan_name, 'Plan') || ' — ' || new.currency || ' ' || new.amount ||
        coalesce(' from ' || new.phone, ''),
      'transactions', new.id
    );
  elsif new.status = 'failed' then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (
      new.org_id, 'payment_failed', 'warning',
      'Payment failed',
      coalesce(v_plan_name, 'Plan') || ' — ' || new.currency || ' ' || new.amount ||
        coalesce(' from ' || new.phone, ''),
      'transactions', new.id
    );
  elsif new.status = 'refunded' then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (
      new.org_id, 'payment_refunded', 'warning',
      'Payment refunded',
      new.currency || ' ' || coalesce(new.refunded_amount, new.amount) ||
        coalesce(' — ' || new.refund_reason, ''),
      'transactions', new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_notify on transactions;
create trigger transactions_notify
  after update on transactions
  for each row execute function notify_on_transaction_status_change();

create or replace function notify_on_device_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'linked' and old.status in ('pending', 'offline', 'error') then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (new.org_id, 'device_linked', 'info', new.name || ' is linked', 'Checked in and reporting live.', 'mikrotik_devices', new.id);
  elsif new.status = 'offline' then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (new.org_id, 'device_offline', 'warning', new.name || ' went offline', 'No heartbeat received recently.', 'mikrotik_devices', new.id);
  elsif new.status = 'error' then
    insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (new.org_id, 'device_error', 'critical', new.name || ' reported an error', null, 'mikrotik_devices', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists devices_notify on mikrotik_devices;
create trigger devices_notify
  after update on mikrotik_devices
  for each row execute function notify_on_device_status_change();

-- ---------------------------------------------------------------------------
-- Stale-device sweep — nothing previously ever moved a device out of
-- "linked" when its heartbeats stopped arriving. Marking it offline here is
-- what lets the trigger above ever fire a "device_offline" notification.
-- pg_cron may not be enabled on every plan/project, so this whole block is
-- best-effort: if it can't enable the extension or schedule the job, it
-- logs a notice and moves on rather than failing the migration.
-- ---------------------------------------------------------------------------
create or replace function sweep_stale_devices()
returns void
language sql
security definer
set search_path = public
as $$
  update mikrotik_devices
    set status = 'offline'
    where status = 'linked'
      and last_seen_at < now() - interval '10 minutes';
$$;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule('echo-sweep-stale-devices', '*/5 * * * *', 'select sweep_stale_devices();');
exception when others then
  raise notice 'pg_cron scheduling skipped (%): run sweep_stale_devices() some other way (e.g. an external cron hitting a small edge function), or enable pg_cron manually from the Dashboard''s Database > Extensions page.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- PPPoE account creation — previously nothing created the first account.
-- Hashing happens here via pgcrypto's bcrypt (already enabled in 0001),
-- compatible with radius-service's bcryptjs.compareSync() at auth time.
-- security invoker (the default) — runs as the calling admin, so it's
-- naturally scoped by current_org_id() same as any other RLS-protected
-- write to these tables, no separate edge function needed.
-- ---------------------------------------------------------------------------
create or replace function create_pppoe_account(
  p_customer_phone text,
  p_customer_name  text,
  p_username       text,
  p_password       text,
  p_plan_id        uuid
)
returns pppoe_accounts
language plpgsql
as $$
declare
  v_org_id      uuid := current_org_id();
  v_customer_id uuid;
  v_account     pppoe_accounts;
begin
  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  insert into customers (org_id, phone, full_name, type)
    values (v_org_id, p_customer_phone, p_customer_name, 'pppoe')
    on conflict (org_id, phone) do update
      set type = case when customers.type = 'hotspot' then 'both' else customers.type end
    returning id into v_customer_id;

  insert into pppoe_accounts (org_id, customer_id, username, password_hash, plan_id, status)
    values (v_org_id, v_customer_id, p_username, crypt(p_password, gen_salt('bf')), p_plan_id, 'active')
    returning * into v_account;

  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds — transactions has no general RLS update policy (on purpose: only
-- service-role edge functions write payment status), so this is the one
-- narrow, deliberate door for an admin to record a refund. security invoker
-- means it runs as the calling admin and is naturally scoped by
-- current_org_id(); it also only ever touches a completed transaction that
-- belongs to that org, and only the refund-specific columns.
-- ---------------------------------------------------------------------------
create or replace function refund_transaction(
  p_transaction_id uuid,
  p_amount         numeric,
  p_reason         text
)
returns transactions
language plpgsql
as $$
declare
  v_org_id uuid := current_org_id();
  v_txn    transactions;
begin
  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  select * into v_txn from transactions where id = p_transaction_id and org_id = v_org_id;
  if v_txn is null then
    raise exception 'Transaction not found';
  end if;
  if v_txn.status != 'completed' then
    raise exception 'Only completed transactions can be refunded (current status: %)', v_txn.status;
  end if;
  if p_amount <= 0 or p_amount > v_txn.amount then
    raise exception 'Refund amount must be between 0 and %', v_txn.amount;
  end if;

  update transactions
    set status = 'refunded', refunded_amount = p_amount, refund_reason = p_reason, refunded_at = now()
    where id = p_transaction_id
    returning * into v_txn;

  return v_txn;
end;
$$;
