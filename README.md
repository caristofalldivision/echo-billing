# Echo

MikroTik hotspot & PPPoE billing system — Pesapal payments (incl. M-Pesa STK push), TalkSasa SMS, Resend email, a real-time admin portal, and a doodle-styled captive portal that lives on the router itself.

## Why this shape

Echo is split across four deployable pieces because no single platform covers "serverless admin portal" and "always-on RADIUS/WireGuard endpoint" at once:

| Piece | Where it runs | Why |
|---|---|---|
| `apps/admin` | Vercel (Next.js) | Admin portal UI. Stateless, scales to zero, fine on serverless. |
| `apps/captive-portal` | **Built here, but deployed onto each MikroTik router** during provisioning | This is what "lives in the MikroTik" — the static bundle is fetched by the router itself into its hotspot files directory. It calls Echo's public API over the internet. |
| `supabase/` | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) | Database, auth, live dashboard data, and all request/response serverless logic (Pesapal, TalkSasa, Resend, voucher generation, provisioning script rendering, the public API the captive portal calls). |
| `radius-service/` | Fly.io (always-on) | The one piece that can't be serverless: RADIUS needs a persistent UDP listener for auth/accounting/CoA-disconnect, and the WireGuard concentrator needs a persistent tunnel endpoint. Reads/writes Postgres directly. |

MikroTik routers reach Echo over a **WireGuard tunnel** (one peer per router) terminated on `radius-service`. RADIUS auth/accounting rides over that tunnel; it's also how the backend reaches each router's MikroTik API for live provisioning/config pushes, without needing the router to have a public IP or port-forwarding.

## Repo layout

```
apps/
  admin/             Next.js admin portal (Vercel)
  captive-portal/    Static captive portal bundle, pushed onto routers
supabase/
  migrations/        SQL schema + RLS
  functions/         Deno edge functions (Pesapal, SMS, email, vouchers, provisioning, portal API)
provisioning/
  templates/         RouterOS (.rsc) script template rendered per device
radius-service/       Always-on RADIUS + WireGuard concentrator (Fly.io)
packages/
  doodles/           Shared hand-drawn SVG doodle set used by both frontends
```

## Local development

Prerequisites: Node 18+, pnpm, the [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for `supabase start` and for `radius-service`), and (optional, for tunnel testing) `wg` / WireGuard tools.

```bash
pnpm install

# 1. Local Supabase stack (Postgres + Auth + Realtime + Storage + functions runtime)
pnpm supabase:start
supabase db reset            # applies supabase/migrations

# 2. Edge functions, served locally
pnpm supabase:functions:serve

# 3. Admin portal
cp apps/admin/.env.example apps/admin/.env.local   # fill in Supabase URL/anon key
pnpm dev:admin                                      # http://localhost:3000

# 4. Captive portal (points at the local edge functions by default)
cp apps/captive-portal/.env.example apps/captive-portal/.env
pnpm dev:portal                                     # http://localhost:5173

# 5. RADIUS service (optional locally — needs Docker + NET_ADMIN for WireGuard)
cd radius-service && cp .env.example .env && docker compose up
```

## Deploying

- **`apps/admin`** → Vercel project pointed at `apps/admin`, env vars from `apps/admin/.env.example`.
- **`supabase/`** → `supabase link` to a hosted project, `supabase db push`, `supabase functions deploy`, and set function secrets (`supabase secrets set ...`) for Pesapal/TalkSasa/Resend keys and the RADIUS service's shared provisioning secret.
- **`radius-service/`** → `fly launch` / `fly deploy` from `radius-service/` (see its README). Needs `DATABASE_URL` (direct Postgres connection, not the pooled one) and a WireGuard server keypair.
- **`apps/captive-portal`** → not deployed to a host at all. `pnpm build:portal` produces static output that's uploaded to Supabase Storage; the `provisioning-script` edge function generates a per-device RouterOS script whose `/tool fetch` calls pull that bundle onto the router itself.

## Status

This is the initial scaffold: schema, admin portal shell with functional core pages, edge function stubs with real provider integration code, captive portal flow, RouterOS provisioning template, and a RADIUS service skeleton. See each subfolder's README for what's wired up vs. still a follow-up.
