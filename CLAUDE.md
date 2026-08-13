# Echo

MikroTik hotspot & PPPoE billing system: Pesapal payments (incl. M-Pesa STK
push), TalkSasa SMS, Resend email, a real-time admin portal, and a
doodle-styled captive portal that lives on the router itself.

## End goal

A single ISP (not multi-tenant, for now) can: link a MikroTik router in one
paste-and-run script with zero manual follow-up; let customers pay for
hotspot access or renew PPPoE from a branded captive portal served by the
router; watch active sessions and revenue update live in the admin portal;
manage vouchers, plans, and SMS/email/payment provider settings from one
place. "Automated" is the operative word — provisioning, fulfillment, and
notifications should require no manual intervention once set up.

## Architecture — four deployable pieces

| Piece | Runs on | Why there |
|---|---|---|
| `apps/admin` | Vercel (Next.js) | Stateless admin UI, scales to zero |
| `apps/captive-portal` | Built here, **deployed onto each router** during provisioning | This is what "lives in the MikroTik" — RouterOS fetches the static bundle into its own hotspot files directory |
| `supabase/` | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) | DB, auth, live dashboard data, and all request/response logic (Pesapal, TalkSasa, Resend, vouchers, provisioning script rendering, the public API the captive portal calls) |
| `radius-service/` | Fly.io (always-on) | The one non-serverless piece — RADIUS needs a persistent UDP listener, WireGuard needs a persistent tunnel endpoint. Reads/writes Postgres directly |

Routers reach Echo over a **WireGuard tunnel** (one peer per router)
terminated on `radius-service`. RADIUS auth/accounting rides that tunnel; it's
also the path for any future live remote-management calls into a router's
MikroTik API. Full rationale: root `README.md`.

## Guardrails — read before changing code here

**Fixed captive-portal filenames are load-bearing, not a style choice.**
RouterOS fetches the portal file-by-file (`/tool fetch`) rather than as an
archive (no reliable unzip/JSON parsing in RouterOS scripting), and its
hotspot server only serves+templates a file named exactly `login.html`. The
manifest lives in `supabase/functions/_shared/router-template.ts`
(`CAPTIVE_PORTAL_FILES`) and `apps/captive-portal/vite.config.js` (fixed,
unhashed output names) must keep producing exactly those paths. If you add a
file to the captive portal build, add it to the manifest *and* a matching
`/tool fetch` line in both `router-template.ts` and the human-readable copy
`provisioning/templates/router-setup.rsc.tpl` — the two must stay in sync.

**Payment fulfillment must stay idempotent and re-verified.**
`pesapal-ipn` never trusts the webhook payload's status — it re-fetches from
Pesapal's `GetTransactionStatus` before fulfilling, and guards on
`transactions.status === 'completed'` before issuing a second voucher/renewal.
Don't "simplify" this by trusting the callback body; Pesapal retries IPNs.

**Voucher claims must stay atomic.** `radius-service/src/db.js`'s
`claimVoucher` does the unused→used transition in a single `UPDATE ... WHERE
status = 'unused' RETURNING *`, so two simultaneous logins with the same code
can't both succeed. Don't replace that with a read-then-write.

**Respect the public/private function boundary.** `supabase/config.toml`
lists exactly which edge functions skip JWT verification (`portal-api`,
`pesapal-ipn`, `heartbeat`) because they're called by anonymous captive-portal
clients, Pesapal, or a router's bearer-token heartbeat — not a signed-in
admin. Everything else uses the caller's Supabase auth JWT and RLS
(`current_org_id()` in `supabase/migrations/0001_init.sql`) to scope data.
Don't add a new public route without asking whether it actually needs to be
public, and don't have a public function use anything but the service-role
client with its own explicit checks.

**No real secrets in git.** Only commit `.env.example` files. Pesapal/
TalkSasa/Resend credentials live in the `organizations` table (edited from
the admin portal's Settings pages), set via `supabase secrets set` for
`radius-service`'s DB/WireGuard secrets, and via `fly secrets set` for
`radius-service` itself — never in `fly.toml`'s `[env]` block or a
`.env` that isn't gitignored.

**Design system is shared on purpose.** Colors/fonts/radii live in
`packages/doodles/tailwind-preset.js`, consumed by `apps/admin`'s
`tailwind.config.js`. Add missing shades there rather than hardcoding hex
values in a page — that gap already caused one build break (missing
`indigo-200`/`400`) during initial setup.

**Only commit when asked**, per standard practice — this repo is no
exception. Prefer small, reviewable commits over one giant diff when doing
follow-up work.

## Local dev quick reference

```bash
pnpm install
pnpm dev:admin      # http://localhost:3000 — boots fine without a backend,
                     # but login/dashboard need a real Supabase project (see below)
pnpm dev:portal     # http://localhost:5173/login.html
supabase start && supabase db reset   # needs Docker
supabase functions serve
```

Full setup steps are in the root `README.md` and each subfolder's own
`README.md` (`apps/admin`, `apps/captive-portal`, `supabase/functions`,
`provisioning`, `radius-service`).

## Status

Initial scaffold is built and committed: schema, admin portal with functional
core pages, edge functions with real provider integration code, captive
portal purchase/voucher flow, RouterOS provisioning template, and a RADIUS +
WireGuard service skeleton. `pnpm install` and `apps/admin`'s dev server have
been verified to run locally. Nothing has been tested against a live
Supabase project, real provider sandbox credentials, or an actual router yet.

## Roadmap

**Phase 1 — wire up real infra.** Create a Supabase project, `supabase link`
+ `supabase db push` the migration, point `apps/admin/.env.local` at it,
create the first admin user, get login → dashboard actually working. Get
Pesapal sandbox, TalkSasa, and Resend credentials into Settings and confirm
test sends/payments round-trip through the edge functions.

**Phase 2 — RADIUS/WireGuard for real.** Deploy `radius-service` (Fly.io,
falling back to a plain VPS if Fly's own WireGuard-based private networking
conflicts — see `radius-service/README.md`). Set `WIREGUARD_SERVER_PUBKEY`/
`WIREGUARD_SERVER_ENDPOINT`/`RADIUS_SHARED_SECRET` function secrets to match.
Verify auth/accounting with `radtest` before touching a real router.

**Phase 3 — first real router.** Run the generated provisioning script on an
actual MikroTik, confirm the WireGuard handshake, RADIUS auth for both a test
voucher and a test PPPoE account, and that the captive portal renders with
`$(link-login-only)` correctly substituted.

**Phase 4 — close the known gaps**, in roughly this priority order:
1. PPPoE account creation UI in the admin portal (currently only renewal via
   payment is wired up — nothing creates the first account).
2. CoA disconnect ("kick this user now" from the admin portal) — routers are
   already configured to accept it on udp/3799, `radius-service` just doesn't
   send it yet.
3. Mikrotik-Rate-Limit VSA so plan speed limits actually apply, not just
   `Session-Timeout`.
4. WireGuard peer teardown when a device is deleted (currently additive-only).
5. Historical session/usage logging — accounting `Stop` just deletes the live
   row today; nothing archives it for usage reports.

**Phase 5 — production hardening.** Move Pesapal/TalkSasa/Resend credentials
from plaintext `organizations` columns into Supabase Vault. Add monitoring/
alerting for `radius-service` uptime and heartbeat gaps. Load-test with
multiple routers and concurrent voucher purchases.

**Phase 6 (later, optional) — multi-tenant.** Only if Echo is sold to more
than one ISP — the schema is already org-scoped for this, but auth, billing
for the ISPs themselves, and per-tenant provider credentials all need design
work first.
