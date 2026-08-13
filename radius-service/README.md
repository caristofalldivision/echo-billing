# radius-service

The one piece of Echo that isn't serverless. Two jobs, one process:

1. **RADIUS server** (`src/radius-auth.js`, `src/radius-acct.js`) — auth on
   udp/1812, accounting on udp/1813. Hotspot logins use a voucher code as
   both username and password (claimed atomically in `db.claimVoucher`, so
   two simultaneous uses of the same code can't both succeed); PPPoE logins
   check `pppoe_accounts` with bcrypt. Accounting writes/deletes rows in
   `active_sessions`, which is how the admin dashboard's realtime view stays
   live — no polling involved on that side, Supabase Realtime pushes the
   Postgres changes straight to the browser.
2. **WireGuard concentrator** (`src/wireguard.js`) — one peer per linked
   router, reconciled from `mikrotik_devices` every 30s. This is what lets
   the RADIUS server identify *which* router an accounting packet came from
   (by matching the UDP source IP to a device's tunnel IP) without routers
   needing a public IP or port-forwarding, and is the path Echo would use
   for any future live remote-management calls into a router's MikroTik API.

## Why here and not Vercel/Supabase

RADIUS is UDP with routers as long-lived clients, and WireGuard needs a
persistent listening endpoint — neither fits a request/response serverless
function. This runs as an always-on container instead.

## Deploying

```bash
fly launch --no-deploy   # first time, picks up fly.toml
fly secrets set \
  DATABASE_URL="postgresql://postgres:...@db.<project>.supabase.co:5432/postgres" \
  RADIUS_SHARED_SECRET="<matches provisioning-script's RADIUS_SHARED_SECRET secret>" \
  WIREGUARD_SERVER_PRIVATE_KEY="<generate with `wg genkey`>"
fly deploy
```

After deploying, set these Supabase function secrets so newly-generated
provisioning scripts point at the right place:
`WIREGUARD_SERVER_PUBKEY` (derive with `wg pubkey < private key file`),
`WIREGUARD_SERVER_ENDPOINT` (`<fly-app>.fly.dev:51820` or a custom domain).

**Caveat:** Fly.io's own private networking is itself WireGuard-based, which
can complicate running a *second*, unrelated WireGuard interface inside a Fly
Machine depending on current platform behavior — verify this works in your
Fly org before relying on it for production, and fall back to a small plain
VPS (DigitalOcean/Linode/Hetzner, anywhere with a static IP and root access)
running the same Docker image if it doesn't. Nothing else in this service is
Fly-specific.

## Local dev

```bash
cp .env.example .env
npm install
npm run dev
```

Test auth without a real router:

```bash
# needs freeradius-utils (radtest) — or use any RADIUS test client
radtest <voucher-code> <voucher-code> localhost 1812 <RADIUS_SHARED_SECRET>
```

## Follow-ups (flagged, not built in this pass)

- **CoA (disconnect)**: routers are already configured to accept CoA on
  udp/3799 (see `provisioning/templates/router-setup.rsc.tpl`), but this
  service doesn't send CoA-Request yet — needed for "kick this user now"
  from the admin portal.
- **Mikrotik-Rate-Limit VSA**: Access-Accept currently only sends
  `Session-Timeout` from the plan; per-plan speed limits need the Mikrotik
  vendor dictionary loaded into the `radius` package and a
  `Mikrotik-Rate-Limit` attribute added in `radius-auth.js`.
- **Peer teardown**: `syncPeers()` is additive — deleting a device in the
  admin portal doesn't yet remove its WireGuard peer.
- Historical session/usage logging (accounting `Stop` currently just deletes
  the live row; nothing archives it for usage reports yet).
