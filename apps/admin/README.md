# Echo admin portal

Next.js 14 (App Router) admin portal. Auth + data via Supabase.

## Pages implemented

- `/login` — Supabase auth sign-in
- `/` — realtime dashboard (active sessions, revenue today, unused vouchers, linked devices)
- `/devices` — add MikroTik, generate its one-time RouterOS provisioning script
- `/plans` — hotspot/PPPoE plan CRUD
- `/vouchers` — batch voucher generation + status list
- `/customers` — customer list with PPPoE account status
- `/transactions` — live payments list
- `/portal-theme` — captive portal branding with live preview
- `/settings/payments` — Pesapal credentials
- `/settings/sms` — TalkSasa credentials + test send
- `/settings/email` — Resend credentials + test send

## Setup

```bash
cp .env.example .env.local   # fill in your Supabase project URL + anon key
pnpm install
pnpm dev
```

First-time local setup: after signing up a user via Supabase Auth (or `supabase/seed.sql`'s instructions), link them as an admin:

```sql
insert into admin_users (id, org_id, full_name, role)
values ('<auth.users.id>', '<organizations.id>', 'Your Name', 'owner');
```

## Types

`src/lib/supabase/types.ts` is hand-written for now. Once you have a live Supabase project, regenerate it:

```bash
supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```
