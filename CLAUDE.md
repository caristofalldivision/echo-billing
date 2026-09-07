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

## Account model

Single org, owner/staff roles. The very first person to visit `/signup`
creates the one `organizations` row and becomes its `owner`
(`bootstrap_organization()` in `supabase/migrations/0002_team_management.sql`,
table-locked so concurrent first-signups can't both win); `/signup`
self-gates closed after that (`org-exists` function) and tells everyone else
to sign in instead. From then on, owners add staff from Settings → Team —
they type an email/name/role and the portal generates a one-time temp
password shown once on screen for the owner to relay manually (no email
dependency, so it works before Resend is ever configured). New hires change
that password from Settings → Account; `/login`'s "Forgot password?" and
the `/auth/callback` PKCE-exchange route cover self-service recovery after
that. All of this — creating/listing/updating/removing `admin_users` rows,
and reading their email from `auth.users` — goes through the
`org-bootstrap`/`admin-list-users`/`admin-add-user`/`admin-update-role`/
`admin-remove-user` edge functions using the service-role client with their
own checks (see `supabase/functions/_shared/auth.ts`'s `getCallerAdmin`),
**not** new RLS policies, because listing teammates needs `auth.users` data
RLS can never expose to a browser client anyway. Owner-only actions guard
against demoting/removing the last remaining owner.

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

**Voucher claims must stay atomic — and "used" no longer means "can never
auth again."** `radius-service/src/db.js`'s `claimVoucher` used to be a
strict one-shot `unused → used` transition; the *first* successful auth
burned the code forever, so anything that dropped the router's hotspot
session before the customer's paid time actually ran out (idle-timeout, a
router reboot clearing `/ip hotspot active`, walking out of range and back)
permanently locked them out with time/data still remaining — found and
fixed 2026-09. It now also accepts the same code again from the **same
device** (matched on `Calling-Station-Id`/MAC, stored in
`vouchers.claimed_mac_address` on first claim) while still inside the
plan's paid duration (`redeemed_at + plans.duration_minutes`) — that MAC
check is what keeps the original anti-sharing property intact; a different
device is still rejected even mid-window. Still a single
`UPDATE ... WHERE ... RETURNING *` — two simultaneous claims of the same
code still can't both succeed, Postgres's row lock during the `UPDATE`
serializes them. Don't replace this with a read-then-write, and don't
"simplify" it back to a bare unused/used flag — that's the exact bug this
fixed.

**Respect the public/private function boundary.** `supabase/config.toml`
lists exactly which edge functions skip JWT verification — `portal-api`,
`pesapal-ipn`, `heartbeat`, `provisioning-fetch`, `ip-bindings-sync`,
`org-exists` — because they're called by anonymous captive-portal clients,
Pesapal, or a router authenticating with its own `provisioning_token`
bearer token — not a signed-in admin. Everything else needs a Supabase auth
JWT *and* must call `getCallerAdmin()` (see the guardrail above — JWT
verification alone isn't enough). Don't add a new public route without
asking whether it actually needs to be public, and don't have a public
function use anything but the service-role client with its own explicit
checks (device-token lookup, IPN re-verification, etc.).

**No real secrets in git.** Only commit `.env.example` files. Pesapal/
TalkSasa/Resend credentials live in the `organizations` table (edited from
the admin portal's Settings pages), set via `supabase secrets set` for
`radius-service`'s DB/WireGuard secrets, and via `fly secrets set` for
`radius-service` itself — never in `fly.toml`'s `[env]` block or a
`.env` that isn't gitignored.

**Two separate design systems — don't mix them.** `packages/doodles` (flat
brand colors, rounded/soft, hand-drawn SVG doodles) is the **captive
portal's** identity only. `apps/admin` (and `apps/landing`) use
`packages/signal` instead — De Stijl/Neoplasticism: flat primary colors,
black rule lines, sharp corners, explicitly zero shadows/blur
(`packages/signal/tailwind-preset.js` sets `boxShadow`/`backdropBlur` to
`none`). Add missing tokens to whichever package the surface actually
consumes rather than hardcoding hex values or reaching for the other
package's tokens — a "make the admin portal look more like the captive
portal" ask should pull the *idea* (e.g. a colorful divider) across and
re-express it in signal's own flat/sharp language, not import doodle assets
into `apps/admin`, which doesn't even depend on `@echo/doodles`.

**Edge functions requiring a Supabase JWT must call `getCallerAdmin()`, not
just rely on `verify_jwt = true`.** The gateway's JWT check only proves the
caller has *some* Supabase auth account — it does not prove they're an
`admin_users` member of this org. Supabase's own signup API isn't gated by
the Next.js `/signup` page's "already set up" check (that's app-level UI,
not an Auth-level restriction), so without an explicit `getCallerAdmin(req)`
check, anyone who can create *any* Supabase account can call the function.
This exact gap was found and fixed in `voucher-generate`, `sms-send`,
`email-send`, `pesapal-initiate`, and `provisioning-script` (2026-09) — the
last of which leaked a router's WireGuard private key and MikroTik API
password to any authenticated caller, with no org-scoping on top of that.
`admin-add-user`/`admin-list-users`/`admin-update-role`/`admin-remove-user`
were always correct — copy that pattern (`getCallerAdmin`, then scope every
query to `caller.org_id`) for any new non-public function, not just the
`verify_jwt = false` check for public ones.

**Only commit when asked**, per standard practice — this repo is no
exception. Prefer small, reviewable commits over one giant diff when doing
follow-up work.

## Gotchas — hard-won, from real hardware and live testing (2026-09)

**RouterOS scripts pasted into WinBox must be one `;`-chained statement,
not multiple lines.** A paste that drops anything after an early line
(copy-paste truncation from a web page, WinBox scrollback confusion,
retyping from a screenshot) leaves earlier lines having genuinely
succeeded and later ones silently never running — RouterOS gives no error,
it just stops. Hit repeatedly in practice with the bootstrap snippet before
`renderBootstrapScript()` was rewritten as one statement. As one statement,
RouterOS either runs the whole thing start to finish or doesn't parse it at
all — nothing to drop partway through. If you ever go back to multiple
lines for readability, you're reintroducing this exact bug class. The admin
portal's Devices page also has a "Copy" button using the Clipboard API
specifically because manual textarea selection has the same truncation
failure mode.

**`/tool fetch dst-path="hotspot/..."` (bare) is not the same location as
`html-directory=hotspot` on every board.** On a RB760iGS (RouterOS 7.x),
RouterOS auto-installs its own bundled default hotspot skin into the real
on-disk `flash/hotspot/` the instant `/ip hotspot add` runs, but a bare
`hotspot/...` `dst-path` landed in a different, sibling top-level directory
that the hotspot server never read from — captive portal files fetched
with zero errors, router silently kept serving MikroTik's own default
login page. Fixed by making `dst-path` explicitly `flash/hotspot/...`
everywhere in `router-template.ts`/`router-setup.rsc.tpl`. If a future
board/RouterOS version shows the stock MikroTik login page instead of
Echo's, check this first via `/file print where name~"hotspot"` — you'll
see two different directories if it's regressed.

**NAT masquerade for the WAN interface is not something `/ip hotspot add`
sets up.** It only configures the pre-login walled-garden/redirect
behavior. Without an explicit `/ip firewall nat` masquerade rule on
`ether1`, hotspot clients authenticate fine and get a DHCP address, but
their traffic to the real internet has no address translation and
silently dies — presents as "connects but no internet" / "doesn't redirect
to anything," not as an auth failure. Section 2b in `router-template.ts`.

**MikroTik hotspot logins usually run inside the OS's restricted
captive-portal mini-browser** (Apple's Captive Network Assistant, Android's
equivalent), not a real browser tab — confirmed live via a "blank/blocked"
page after a popup-based Pesapal checkout. That mini-browser is known to
block/mishandle `window.open()` and handle chained redirects/meta-refresh
badly. The purchase flow does a **plain full-page redirect** to Pesapal
instead (`window.location.href`), and gets back to the captive portal via
`window.location.origin` (captured client-side before leaving — a LAN
address the backend has no other way to know) embedded in Pesapal's
`callback_url`, landing directly on `login.html?transactionId=...` — no
intermediate page. Don't reintroduce a popup or an extra redirect hop here
without testing specifically inside a phone's real captive-portal
assistant, not just a desktop browser.

**Pesapal's IPN webhook is not reliable enough to be the only fulfillment
trigger**, at least on sandbox/demo credentials — observed to simply never
fire. `portal-api`'s `/status` route (what the captive portal polls) and
its `/return` route both also call `reconcileTransaction()` (in
`_shared/fulfillment.ts`) to actively re-verify with Pesapal's
`GetTransactionStatus` and fulfill right there — same idempotent,
re-verified logic the webhook uses, just triggered from three places
instead of one. If "customer paid but never got connected" resurfaces,
check whether all three paths are still wired up before assuming it's a
new bug.

**TalkSasa's send endpoint only accepts bare-254 phone numbers**
(`254768557160`) — not `+254768557160`, not the local `0768557160` format
the captive portal's own phone input collects. Normalized centrally in
`_shared/sms.ts`'s `sendSms()` so every caller gets it automatically;
don't add a second normalization path elsewhere; if a caller needs a
different provider's format, normalize at the call site, not by changing
the shared one.

**RADIUS vendor-specific attributes cannot be encoded flat by name.** The
`radius` npm package throws `"unknown attribute"` if you push e.g.
`["Mikrotik-Rate-Limit", "512k/1M"]` directly — VSAs must be wrapped:
`["Vendor-Specific", 14988, [["Mikrotik-Rate-Limit", "512k/1M"]]]`, per
RFC 2865's base `Vendor-Specific` (type 26) attribute. Confirmed by
round-tripping encode/decode standalone before wiring it into
`radius-auth.js` — the flat form would have thrown on the very first
speed-limited login and likely taken down the whole RADIUS process (an
uncaught error in the `dgram` message handler). `Mikrotik-Rate-Limit`
format is `rx-rate/tx-rate` where rx/tx are from the *router's* point of
view (rx = client's upload, tx = client's download) per MikroTik's own
convention — not independently verified against a live router yet, worth
confirming upload/download land the right way round the first time a
speed-limited plan is actually tested end-to-end.

**RouterOS scheduler `add` with `:if ([:len [find name=...]] = 0)` only
creates a scheduler once — it never updates an existing one's `on-event`.**
Re-running provisioning after changing a scheduler's logic (as happened
adding the immediate-heartbeat-fire, then the ip-sync scheduler) does
nothing on an already-provisioned router unless that scheduler is
new/differently-named. When adding a *new* scheduled behavior, prefer a
new, separately-named scheduler (e.g. `echo-ip-sync` alongside
`echo-heartbeat`, not folded into it) over changing an existing one's
`on-event` string in place — that way existing routers keep working
exactly as before until they're deliberately re-provisioned, and a bug in
the new scheduler can't take down the heartbeat that makes devices show as
"linked" at all.

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

Phases 1–3 are done and proven against a real MikroTik (RB760iGS): Supabase
project linked and migrated, `radius-service` deployed to Fly.io
(`echo-radius` app — see "Fly.io gotcha" below), a real router provisioned,
WireGuard handshake confirmed, hotspot voucher purchase (Pesapal sandbox
STK push → RADIUS auth → auto-connect) working end to end, PPPoE auth path
built. Phase 4's gap list has mostly closed since it was written — see
below for what's actually still open. Admin portal has grown well past
"functional core pages": accounting/revenue dashboards with interactive
charts, a notifications system (DB-trigger-driven, not scattered
insert-calls), SMS compose + history, voucher compensation as an
alternative to cash refunds, per-device IP allowlisting, and a redesigned
grouped sidebar — all on top of the original customers/devices/plans/
vouchers/transactions pages.

**Fly.io gotcha:** the account this project's `flyctl` is logged into
(`echonet25@gmail.com`) has a *second*, unrelated app called
`flow-wallet-api` with 3 active machines. `radius-service/fly.toml` pins
`app = "echo-radius"`, but any bare `fly` command run outside that
directory (or without `-a echo-radius`) should still be double-checked
against `fly apps list` before deploying — don't scale or deploy onto the
wrong app. `echo-radius` itself is deliberately 1 machine (see
`radius-service/README.md` on WireGuard session-affinity if that's ever
tempting to change).

## Roadmap

**Phase 4 — remaining known gaps**, in roughly priority order:
1. CoA disconnect ("kick this user now" from the admin portal) — routers are
   already configured to accept it on udp/3799, `radius-service` just doesn't
   send it yet.
2. Data-cap enforcement — `plans.data_cap_mb` is tracked (session_history/
   active_sessions accumulate real bytes now) but nothing acts on a customer
   exceeding it; needs CoA disconnect (above) as its mechanism.
3. WireGuard peer teardown when a device is deleted (currently additive-only
   in `radius-service/src/wireguard.js`'s `syncPeers()`).
4. `Mikrotik-Rate-Limit` VSA is now sent (2026-09) but the rx/tx
   (upload/download) ordering hasn't been confirmed against a live router
   yet — verify the first time a speed-limited plan is actually tested.
5. IP allowlist enforcement (`ip-bindings-sync` + the `echo-ip-sync`
   scheduler) needs a router to re-provision before it takes effect on
   anything already linked — not yet verified against real hardware.

**Phase 5 — production hardening.** Move Pesapal/TalkSasa/Resend credentials
from plaintext `organizations` columns into Supabase Vault. Add monitoring/
alerting for `radius-service` uptime and heartbeat gaps. Load-test with
multiple routers and concurrent voucher purchases. Confirm whether the live
Supabase project's Auth settings actually have public signup disabled
(`supabase/config.toml`'s `enable_signup = true` only governs the local dev
stack, not the hosted project) — the `getCallerAdmin()` checks added 2026-09
are defense in depth regardless, but signup being open on the real project
would still let anyone create an account, just not act on it anywhere
useful anymore.

**Phase 6 (later, optional) — multi-tenant.** Only if Echo is sold to more
than one ISP — the schema is already org-scoped for this, but auth, billing
for the ISPs themselves, and per-tenant provider credentials all need design
work first.
