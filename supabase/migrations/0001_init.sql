-- Echo billing system — initial schema
-- Single-tenant today (one row in `organizations`), but every table is org-scoped
-- so multi-tenant is a later migration rather than a rewrite.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null default 'Echo',
  support_phone          text,
  support_email          text,
  brand_primary_color    text not null default '#5B5FEF',
  brand_secondary_color  text not null default '#FFB84D',
  brand_logo_url         text,

  -- Provider credentials. NOTE: stored as plaintext columns behind RLS for this
  -- scaffold; before going to production move these into Supabase Vault
  -- (pgsodium) and reference secret ids here instead of raw values.
  pesapal_env               text not null default 'sandbox' check (pesapal_env in ('sandbox', 'live')),
  pesapal_consumer_key      text,
  pesapal_consumer_secret   text,
  pesapal_ipn_id            text,

  talksasa_api_key      text,
  talksasa_sender_id    text,

  resend_api_key        text,
  resend_from_email     text,
  resend_from_name      text not null default 'Echo',

  created_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- admin_users — one row per Supabase Auth user who can access the admin portal
-- ---------------------------------------------------------------------------
create table admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  full_name   text,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now()
);

create index admin_users_org_id_idx on admin_users(org_id);

-- Helper used throughout RLS policies below.
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from admin_users where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- mikrotik_devices
-- ---------------------------------------------------------------------------
create table mikrotik_devices (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organizations(id) on delete cascade,
  name                        text not null,
  site                        text,
  model                       text,
  routeros_version            text,
  public_ip                   inet,

  wireguard_server_pubkey     text,
  wireguard_client_pubkey     text,
  wireguard_client_privkey    text, -- generated server-side once, handed to the device via the one-time provisioning script; see radius-service README for rotation plan
  wireguard_tunnel_ip         inet,

  mikrotik_api_username       text,
  mikrotik_api_password       text,

  provisioning_token          text not null unique default encode(gen_random_bytes(24), 'hex'),
  status                      text not null default 'pending' check (status in ('pending', 'linked', 'offline', 'error')),
  last_seen_at                timestamptz,
  created_at                  timestamptz not null default now()
);

create index mikrotik_devices_org_id_idx on mikrotik_devices(org_id);

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table plans (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  type               text not null check (type in ('hotspot', 'pppoe')),
  name               text not null,
  description        text,
  price              numeric(10, 2) not null,
  currency           text not null default 'KES',
  duration_minutes   integer, -- null = no time limit (pppoe monthly plans etc.)
  data_cap_mb        integer, -- null = unlimited
  speed_down_kbps    integer,
  speed_up_kbps      integer,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index plans_org_id_idx on plans(org_id);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  full_name   text,
  phone       text not null,
  email       text,
  type        text not null default 'hotspot' check (type in ('hotspot', 'pppoe', 'both')),
  created_at  timestamptz not null default now(),
  unique (org_id, phone)
);

create index customers_org_id_idx on customers(org_id);

-- ---------------------------------------------------------------------------
-- pppoe_accounts
-- ---------------------------------------------------------------------------
create table pppoe_accounts (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  customer_id         uuid references customers(id) on delete set null,
  username            text not null,
  password_hash       text not null,
  plan_id             uuid references plans(id),
  mikrotik_device_id  uuid references mikrotik_devices(id),
  status              text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (org_id, username)
);

create index pppoe_accounts_org_id_idx on pppoe_accounts(org_id);
create index pppoe_accounts_mikrotik_device_id_idx on pppoe_accounts(mikrotik_device_id);

-- ---------------------------------------------------------------------------
-- vouchers
-- ---------------------------------------------------------------------------
create table vouchers (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  code                      text not null unique,
  plan_id                   uuid not null references plans(id),
  mikrotik_device_id        uuid references mikrotik_devices(id), -- null = redeemable on any device
  batch_id                  uuid not null default gen_random_uuid(),
  status                    text not null default 'unused' check (status in ('unused', 'used', 'expired', 'revoked')),
  created_by                uuid references admin_users(id),
  redeemed_by_customer_id   uuid references customers(id),
  redeemed_at               timestamptz,
  expires_at                timestamptz,
  created_at                timestamptz not null default now()
);

create index vouchers_org_id_status_idx on vouchers(org_id, status);
create index vouchers_batch_id_idx on vouchers(batch_id);

-- ---------------------------------------------------------------------------
-- active_sessions — written by radius-service, read live by the dashboard
-- ---------------------------------------------------------------------------
create table active_sessions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  mikrotik_device_id  uuid references mikrotik_devices(id) on delete cascade,
  session_type        text not null check (session_type in ('hotspot', 'pppoe')),
  username            text not null,
  framed_ip           inet,
  mac_address         text,
  acct_session_id     text not null,
  session_start       timestamptz not null default now(),
  last_update_at      timestamptz not null default now(),
  bytes_in            bigint not null default 0,
  bytes_out           bigint not null default 0,
  unique (mikrotik_device_id, acct_session_id)
);

create index active_sessions_org_id_idx on active_sessions(org_id);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table transactions (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organizations(id) on delete cascade,
  customer_id                 uuid references customers(id),
  voucher_id                  uuid references vouchers(id),
  pppoe_account_id            uuid references pppoe_accounts(id),
  plan_id                     uuid not null references plans(id),
  amount                      numeric(10, 2) not null,
  currency                    text not null default 'KES',
  method                      text not null default 'mpesa_stk' check (method in ('mpesa_stk', 'card', 'manual')),
  status                      text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  phone                       text,
  pesapal_order_tracking_id   text,
  pesapal_merchant_reference  text not null unique,
  created_at                  timestamptz not null default now(),
  completed_at                timestamptz
);

create index transactions_org_id_status_idx on transactions(org_id, status);
create index transactions_tracking_id_idx on transactions(pesapal_order_tracking_id);

-- ---------------------------------------------------------------------------
-- sms_logs / email_logs
-- ---------------------------------------------------------------------------
create table sms_logs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  recipient_phone  text not null,
  template         text,
  message          text not null,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_ref     text,
  error            text,
  created_at       timestamptz not null default now()
);

create table email_logs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  recipient_email  text not null,
  template         text,
  subject          text not null,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_ref     text,
  error            text,
  created_at       timestamptz not null default now()
);

create index sms_logs_org_id_idx on sms_logs(org_id);
create index email_logs_org_id_idx on email_logs(org_id);

-- ---------------------------------------------------------------------------
-- captive_portal_themes
-- ---------------------------------------------------------------------------
create table captive_portal_themes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  mikrotik_device_id  uuid references mikrotik_devices(id), -- null = org-wide default theme
  logo_url            text,
  primary_color       text not null default '#5B5FEF',
  secondary_color     text not null default '#FFB84D',
  doodle_set          text not null default 'waves',
  headline            text not null default 'Get Connected',
  tagline             text,
  terms_text          text,
  support_phone       text,
  support_whatsapp    text,
  updated_at          timestamptz not null default now(),
  unique (org_id, mikrotik_device_id)
);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  admin_user_id  uuid references admin_users(id),
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create index audit_log_org_id_idx on audit_log(org_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — admin portal users only, scoped to their org.
-- Edge functions use the service_role key (bypasses RLS) for anything the
-- public captive portal or webhooks need to touch.
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;
alter table admin_users enable row level security;
alter table mikrotik_devices enable row level security;
alter table plans enable row level security;
alter table customers enable row level security;
alter table pppoe_accounts enable row level security;
alter table vouchers enable row level security;
alter table active_sessions enable row level security;
alter table transactions enable row level security;
alter table sms_logs enable row level security;
alter table email_logs enable row level security;
alter table captive_portal_themes enable row level security;
alter table audit_log enable row level security;

create policy "admins can read own org" on organizations
  for select using (id = current_org_id());
create policy "owners can update own org" on organizations
  for update using (id = current_org_id() and exists (
    select 1 from admin_users where id = auth.uid() and role = 'owner'
  ));

create policy "admins can read own org admin_users" on admin_users
  for select using (org_id = current_org_id());

-- Generic "org member can read/write" policy, repeated per org-scoped table.
create policy "org member rw" on mikrotik_devices for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member rw" on plans for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member rw" on customers for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member rw" on pppoe_accounts for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member rw" on vouchers for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member read" on active_sessions for select
  using (org_id = current_org_id());
create policy "org member read" on transactions for select
  using (org_id = current_org_id());
create policy "org member read" on sms_logs for select
  using (org_id = current_org_id());
create policy "org member read" on email_logs for select
  using (org_id = current_org_id());
create policy "org member rw" on captive_portal_themes for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org member read" on audit_log for select
  using (org_id = current_org_id());

-- ---------------------------------------------------------------------------
-- Realtime — the admin dashboard subscribes to these.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table active_sessions;
alter publication supabase_realtime add table transactions;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('branding', 'branding', true),
  ('doodles', 'doodles', true),
  ('captive-portal-builds', 'captive-portal-builds', true)
on conflict (id) do nothing;

create policy "public read branding" on storage.objects for select
  using (bucket_id = 'branding');
create policy "public read doodles" on storage.objects for select
  using (bucket_id = 'doodles');
create policy "public read captive-portal-builds" on storage.objects for select
  using (bucket_id = 'captive-portal-builds');

create policy "admins write branding" on storage.objects for insert
  with check (bucket_id = 'branding' and auth.role() = 'authenticated');
create policy "admins update branding" on storage.objects for update
  using (bucket_id = 'branding' and auth.role() = 'authenticated');
