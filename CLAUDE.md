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

**Two design systems, both loaded into `apps/admin`, used for different
things — don't conflate them.** `apps/admin/tailwind.config.js` loads
*both* `@echo/doodles/tailwind-preset.js` and
`@echo/signal/tailwind-preset.js` as presets, so tokens from either are
available anywhere in the app. `packages/signal` (flat primary colors,
black rule lines, sharp corners, explicitly zero shadows/blur —
`boxShadow`/`backdropBlur` set to `none`) is the admin portal's **own**
chrome/UI identity — sidebar, cards, buttons, the dashboard itself.
`packages/doodles` (flat brand colors, rounded/soft, hand-drawn SVG
doodles) is the **captive portal's** identity, and inside `apps/admin` it
exists specifically for previewing/rendering what the captive portal will
look like — see `portal-theme/page.tsx`'s live-preview panel, which
deliberately uses doodle tokens (`rounded-echo`, `font-display`,
`text-echo-muted`) because it's showing the admin what a *customer* sees,
not the admin's own UI. When building a genuinely new admin-facing surface
(a new page, the sidebar, etc.), reach for `signal` tokens — that's the
admin's real identity. Doodle tokens belong in `apps/admin` only where the
surface's whole job is representing the captive portal.

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
fire. `portal-api`'s `/status` route (what the captive portal polls), its
`/return` route, and a `reconcile-pending` edge function on a 1-minute
`pg_cron` sweep (migration `0009_reconcile_pending_sweep.sql`, added
2026-09) all also call `reconcileTransaction()` (in `_shared/fulfillment.ts`)
to actively re-verify with Pesapal's `GetTransactionStatus` and fulfill
right there — same idempotent, re-verified logic the webhook uses, now
triggered from four places instead of one. The sweep exists specifically
because the other three all depend on the customer's browser staying open
long enough to hit them (the captive-portal purchase flow's `callback_url`
points straight at the router's `login.html`, not through `/return`, so
`/return`'s reconcile only ever runs when there's no `returnOrigin` — not
the real hotspot path) — it's the one trigger that doesn't. If "customer
paid but never got connected" resurfaces, check the sweep is still
scheduled (`cron.job` in Postgres) before assuming a new bug.

**A working `reconcileTransaction()` trigger doesn't mean it's actually
reachable — verify the query, not just that the route exists.** Found
2026-09: `/status`'s select embedded `vouchers(code)`, and once the
voucher-compensation feature added a *second* FK between `transactions`
and `vouchers` (`compensation_for_transaction_id`), that embed became
ambiguous and PostgREST rejected the query outright — every single
`/status` call silently returned `{"error":"Transaction not found"}`
regardless of real payment status. This went undetected because IPN
happened to fire on every test payment until it didn't; the "reliable"
client-poll fallback had actually been dead the whole time. Whenever a
new FK is added to a table that's already embedded in an existing
`.select("*, thatTable(...)")` elsewhere in the codebase, grep for that
table name across `supabase/functions` and disambiguate every embed with
`!fk_name` (e.g. `vouchers!transactions_voucher_id_fkey(code)`) — don't
assume an old, previously-working embed is still unambiguous.

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

**Pesapal's hosted checkout page loads render-blocking third-party scripts
that must be in the walled garden, or checkout stalls for a full connection
timeout on each one.** Found 2026-09 via `curl`-ing a live checkout page and
grepping its `<script src>` tags: `h.online-metrix.net` (device
fingerprinting) and `songbird.cardinalcommerce.com` (3-D Secure) are loaded
with plain blocking `<script>` tags in `<head>`/body, neither covered by
`*.pesapal.com`. With the router blocking them (default: everything not
walled-gardened is blocked pre-auth), the browser hangs on each one before
continuing — this was most of what made checkout "take way too long" and
likely caused customers to close the mini-browser before the STK push even
fired, which is its own separate failure mode (see the IPN/reconcile
gotchas above — a closed browser means no `/status` polling either). Full
current list lives in `router-template.ts`/`router-setup.rsc.tpl`'s section
7 — if Pesapal changes their checkout page's dependencies, re-check with
the same `curl`+grep approach rather than guessing.

**Hotspot clients should get the router's own address as DNS, not an
external resolver directly.** `dns-server=1.1.1.1,8.8.8.8` on the DHCP
network (the original config) meant every unauthenticated client's DNS
query round-tripped off-box before the hotspot could even see the HTTP
request to intercept — a real contributor to slow-feeling redirects,
especially on high-latency links. Fixed by pointing DHCP at the bridge's
own address and configuring `/ip dns set allow-remote-requests=yes
servers=1.1.1.1,8.8.8.8 cache-size=2048KiB` so the router answers locally
(caching) and only falls back to the public resolvers on a miss.

**Neither of the two fixes above apply to an already-provisioned router
automatically** — same as the scheduler gotcha below, RouterOS only picks
up template changes on a re-run of the provisioning script. It's safe to
re-run (idempotent), but don't expect an existing deployment to have picked
this up without being told to.

**Voucher codes must verify/authenticate with or without the dash.**
Codes are generated (and stored) as `XXXXX-XXXXX`, but customers routinely
type them without it (phone keyboards, autocomplete). `normalizeVoucherCode`
(strip non-alphanumerics, re-insert the dash at position 5) exists in two
places that can never share an import — `supabase/functions/_shared/
vouchers.ts` (used by `portal-api`'s `check-voucher` route) and
`radius-service/src/radius-auth.js` (used right before `db.claimVoucher`,
the actual RADIUS auth-granting call) — because one is a Deno/TS function
and the other a Node/CJS service with no shared package between them. If
you change the code format or the normalization logic, update both; a
mismatch means one boundary accepts a dash-less code and the other
silently rejects it.

**A parameter used only in ambiguous positions (e.g. `$n is null` inside an
`OR`) can make Postgres's own type inference fail even when the same
parameter resolves unambiguously elsewhere in the same query.** Found
2026-09-10, live: `radius-service/src/db.js`'s `claimVoucher` had
`(v.claimed_mac_address is null or $2 is null or v.claimed_mac_address = $2)`
— despite `$2` also appearing (and being resolvable to `text`) in the
`coalesce()` in the `SET` clause and in the `= $2` comparison in that very
same `OR`, Postgres's parameter-type inference (which runs against the
query text alone, before any values are bound) bailed on the `$2 is null`
branch and threw `42P08 could not determine data type of parameter $2` on
*every single call* — silently caught by `radius-auth.js`'s try/catch,
logged, and turned into a REJECT. This meant every voucher claim rejected
unconditionally, RADIUS-wide, for both "I have a voucher" redemptions and
the auto-connect step right after a successful Pesapal payment (both call
this same function) — the captive portal would show "Valid" (that's just
`check-voucher`, a separate read-only check) and then the customer never
actually got connected. Found by reading `fly logs -a echo-radius` and
seeing the real router's REJECTs, then reproduced standalone against the
live DB before fixing. Fixed by casting `$2::text` at each occurrence.
**If you add a new nullable parameter to a claim/update query like this,
cast it explicitly wherever it appears — don't rely on one unambiguous
usage elsewhere in the same statement to save the others.**

**Navigating to an external HTTPS site (`window.location.href = url`) from
inside an async callback — after an `await fetch(...)`, not straight from a
click handler — can silently fail or show an "unverified page / open in
browser" prompt inside a mobile OS's captive-portal mini-browser** (Apple's
Captive Network Assistant, Android's equivalent). These mini-browsers tie
whether they'll follow a top-level navigation to an external domain to
whether it's still directly associated with the user's own gesture; an
`await` in between is enough to lose that association on stricter
devices/OS versions, and this varied by device in exactly the way it was
reported (works on some phones, "not verified"/"open in browser" on
others) — found 2026-09-10 in `apps/captive-portal/src/main.js`'s Pesapal
purchase flow. Before assuming this means the walled garden is missing a
domain (see the Pesapal-checkout-scripts gotcha above), re-`curl` the
actual checkout page first — in this case the domain list was already
complete. Fixed by rendering a real, explicitly-tapped `<a href>` ("Continue
to secure payment") once the order is created, instead of auto-navigating,
so the tap itself carries the gesture. This is specific to leaving the
captive portal's own origin (the Pesapal redirect) — the MikroTik hotspot
login form's own `.submit()` (used for both voucher redemption and
post-payment auto-connect) is a local POST back to the router's own
`$(link-login-only)`, not a cross-origin navigation, and isn't subject to
this restriction.

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

**2026-09 payment/UX hardening pass** (live-tested against the real
RB760iGS via direct API/DB inspection, not just code review): fixed the
`/status` ambiguous-embed bug and added the `reconcile-pending` cron sweep
(see gotchas above) — both stuck-pending test transactions recovered live
during the fix; added dash-insensitive voucher verification; found and
walled-gardened Pesapal's checkout-page dependencies plus switched hotspot
DNS to the router itself; added a warm-isolate in-memory cache for
`portal-api`'s `/theme`/`/plans` (deliberately not Redis — single-org,
low-QPS doesn't justify a shared cache tier). All deployed. **Not yet
verified**: whether the walled-garden/DNS fix actually shortens the
real-world redirect time on hardware — needs a router re-provision and a
live retest, not yet done as of this writing.

**2026-09-10 fix:** the "hotspot voucher purchase working end to end" claim
above regressed without anyone noticing — the MAC-binding change
(`claimed_mac_address`) broke `claimVoucher` outright (see the Postgres
param-type-inference gotcha above), so **every** voucher claim had been
silently rejecting since that landed, for both manual voucher entry and the
post-payment auto-connect. Found via live Fly logs, fixed, redeployed,
re-verified against prod. Also hardened the Pesapal redirect against mobile
captive-browser gesture-loss (see gotcha above), and started migrating the
captive portal's asset host from the raw Supabase Storage URL to
`captive.echoisp.click` — see `apps/captive-portal/README.md`'s "Building
for a router" section; **the live project's `CAPTIVE_PORTAL_BASE_URL`
secret is still pinned to the old Storage URL** until that domain is
actually hosting the build. Repo moved to
`github.com/caristofalldivision/echo-billing` (`main`); Vercel deployment
is on the user from here.

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
