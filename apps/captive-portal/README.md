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

```bash
pnpm build                # outputs dist/login.html, dist/assets/*
```

Upload `dist/` to the `captive-portal-builds` Supabase Storage bucket
(same relative paths) — the RouterOS provisioning script's `/tool fetch`
calls pull from `${SUPABASE_URL}/storage/v1/object/public/captive-portal-builds/...`.
