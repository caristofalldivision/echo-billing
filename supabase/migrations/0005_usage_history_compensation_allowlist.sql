create table if not exists session_history (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  mikrotik_device_id  uuid references mikrotik_devices(id) on delete cascade,
  session_type        text not null check (session_type in ('hotspot', 'pppoe')),
  username            text not null,
  framed_ip           inet,
  mac_address         text,
  acct_session_id     text not null,
  session_start       timestamptz,
  session_end         timestamptz not null default now(),
  bytes_in            bigint not null default 0,
  bytes_out           bigint not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists session_history_org_id_username_idx on session_history(org_id, username);
create index if not exists session_history_org_id_end_idx on session_history(org_id, session_end desc);

alter table session_history enable row level security;

drop policy if exists "org member read" on session_history;
create policy "org member read" on session_history for select
  using (org_id = current_org_id());

create table if not exists ip_allowlist (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  mikrotik_device_id uuid not null references mikrotik_devices(id) on delete cascade,
  ip_address         inet not null,
  label              text,
  created_by         uuid references admin_users(id),
  created_at         timestamptz not null default now(),
  unique (mikrotik_device_id, ip_address)
);

create index if not exists ip_allowlist_org_id_idx on ip_allowlist(org_id);
create index if not exists ip_allowlist_device_id_idx on ip_allowlist(mikrotik_device_id);

alter table ip_allowlist enable row level security;

drop policy if exists "org member rw" on ip_allowlist;
create policy "org member rw" on ip_allowlist for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

alter table vouchers
  add column if not exists compensation_for_transaction_id uuid references transactions(id),
  add column if not exists compensation_reason text;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'payment_completed', 'payment_failed', 'payment_refunded', 'voucher_compensation',
    'device_linked', 'device_offline', 'device_error',
    'voucher_low'
  ));

create or replace function generate_voucher_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..10 loop
    code := code || substr(alphabet, (floor(random() * length(alphabet)) + 1)::int, 1);
    if i = 5 then
      code := code || '-';
    end if;
  end loop;
  return code;
end;
$$;

create or replace function compensate_transaction_with_voucher(
  p_transaction_id uuid,
  p_reason         text
)
returns vouchers
language plpgsql
as $$
declare
  v_org_id  uuid := current_org_id();
  v_txn     transactions;
  v_code    text;
  v_voucher vouchers;
begin
  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  select * into v_txn from transactions where id = p_transaction_id and org_id = v_org_id;
  if v_txn is null then
    raise exception 'Transaction not found';
  end if;
  if v_txn.status != 'completed' then
    raise exception 'Only completed transactions can be compensated (current status: %)', v_txn.status;
  end if;

  loop
    v_code := generate_voucher_code();
    exit when not exists (select 1 from vouchers where code = v_code);
  end loop;

  insert into vouchers (
    org_id, code, plan_id, status, created_by, expires_at,
    compensation_for_transaction_id, compensation_reason
  )
    values (
      v_org_id, v_code, v_txn.plan_id, 'unused', auth.uid(),
      now() + interval '7 days', v_txn.id, p_reason
    )
    returning * into v_voucher;

  insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (
      v_org_id, 'voucher_compensation', 'info', 'Compensation voucher issued',
      v_code || coalesce(' - ' || p_reason, ''), 'vouchers', v_voucher.id
    );

  return v_voucher;
end;
$$;
