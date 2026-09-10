# Echo captive portal

Plain HTML/CSS/JS (no framework) — deliberately. RouterOS fetches this bundle
file-by-file onto the router during provisioning (see
`supabase/functions/_shared/router-template.ts`), so output filenames must be
fixed and known ahead of time; a framework's hashed build output would break
that. Vite is used only to bundle/serve, with hashing disabled (see
`vite.config.js`).

`login.html` (not `index.html`) is the entry point — RouterOS's hotspot
server looks for that exact filename in `html-directory` and only inside that
request substitutes `$(link-login-only)`, `$(link-orig)`, etc. Those
variables render as literal text in local dev; the login form only actually
works when served by a real router.

## Flow

- **Buy Access** — fetch plans from `portal-api/plans`, collect a phone
  number, `POST portal-api/purchase` (creates a Pesapal order + STK push),
  poll `portal-api/status` until the payment completes, then auto-submit the
  hidden MikroTik login form using the issued voucher code as both username
  and password (RADIUS on `radius-service` validates it against the
  `vouchers` table).
- **I have a voucher** — validates a code via `portal-api/check-voucher`,
  then does the same auto-login.
- Branding (colors, logo, headline, terms) is fetched live from
  `portal-api/theme` on load, so changes made in the admin portal's captive
  portal customizer show up without re-provisioning routers.

## Local dev

```bash
cp .env.example .env      # point at your local/hosted functions URL
pnpm install
pnpm dev                  # open http://localhost:5173/login.html
```

## Building for a router

`VITE_FUNCTIONS_BASE_URL` is baked into the bundle at build time — if you
don't set it, it silently falls back to the `.env.example` value
(`http://localhost:54321/functions/v1`), and every fetch from a real
router's captive portal (plans, purchase, voucher check) will fail because
it's trying to reach `localhost` on the customer's own phone. This bit us
once already; always set it explicitly for a real build:

```bash
VITE_FUNCTIONS_BASE_URL=https://<project-ref>.supabase.co/functions/v1 pnpm build
# outputs dist/login.html, dist/redirect.html, dist/assets/*
```

The provisioning script's `/tool fetch` calls default to
`https://captive.echoisp.click/...` (`CAPTIVE_PORTAL_BASE_URL` in
`supabase/functions/_shared/router-template.ts`'s callers — override with
the `CAPTIVE_PORTAL_BASE_URL` function secret if you're hosting elsewhere).
Deploy `dist/` there as a static site — e.g. a Vercel project (same
platform as `apps/admin`) with `captive.echoisp.click` as its custom
domain, build command `vite build`, output directory `dist`. Vite's fixed
output filenames (see `vite.config.js`) mean the deployed paths land
exactly where RouterOS's `/tool fetch` calls expect them — no rewrites
needed, as long as `login.html` isn't renamed to `index.html` by whatever
static host you use.

(Older deployments may still point `CAPTIVE_PORTAL_BASE_URL` at a Supabase
Storage bucket instead — matching `CAPTIVE_PORTAL_FILES` in
`supabase/functions/_shared/router-template.ts` at the same relative
paths works there too, e.g.
`${SUPABASE_URL}/storage/v1/object/public/captive-portal-builds/...`.)

`redirect.html` is a MikroTik-native template (not built by Vite — it lives
in `public/` and is copied verbatim) that RouterOS's hotspot uses to catch
an arbitrary unauthenticated request and forward it to `/login`. Without
it, the login page still works if hit directly at `/login`, but nothing
ever redirects a client there in the first place.

After uploading, any router that was already provisioned won't pick up the
change until its script is re-run — `/tool fetch`ing these files only
happens during provisioning, the router doesn't live-sync from Storage.
