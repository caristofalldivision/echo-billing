# Provisioning

Echo links a MikroTik with a **one-time script**, not an install wizard —
this is what makes it "automated": an admin adds the device in the portal,
downloads/copies one script, runs it once, and from then on the router is
fully managed (RADIUS auth/accounting, live remote reach over WireGuard,
captive portal pulled directly onto the router).

## How it's generated

`templates/router-setup.rsc.tpl` here is a **reference copy** for review —
the script actually handed to admins (via `/devices` → "Get setup script" in
the admin portal) is rendered by
[`supabase/functions/_shared/router-template.ts`](../supabase/functions/_shared/router-template.ts),
which fills in device-specific values (fresh WireGuard keypair, tunnel IP,
generated MikroTik API credentials, the org's captive portal build URL).
Keep both in sync if you change one.

## What the script does, in order

1. Creates a WireGuard interface + peer tunnelling to `radius-service` on Fly.io.
2. Registers `radius-service` as the RADIUS server for both hotspot and PPPoE
   (auth + accounting), reachable over that tunnel.
3. Points the hotspot profile and PPP AAA at RADIUS.
4. Opens the walled garden for Echo's API domain and Pesapal's domains, so
   the captive portal can process payments before the customer is authenticated.
5. Creates a scoped API user Echo's backend can use over the tunnel for future
   live config pushes.
6. Fetches the captive portal bundle (built from `apps/captive-portal`) file
   by file into the hotspot's `html-directory` — this is what makes the
   portal "live on the router" rather than being proxied from the cloud.
7. Adds a scheduler task that pings the `heartbeat` edge function every 5
   minutes so the admin portal can show the device as online.

## Idempotency

Every section checks `find` before adding, so re-running the script (e.g.
after a firmware reset partially wiped config) is safe and won't duplicate
interfaces, peers, or users.

## Known limitations / follow-ups

- RouterOS has no reliable unzip or JSON parsing, so the captive portal is
  fetched as a fixed list of files (`CAPTIVE_PORTAL_FILES` in
  `router-template.ts`) rather than a single archive. If you add files to
  `apps/captive-portal`'s build output, add a matching `/tool fetch` line.
- The heartbeat is liveness-only for now — it doesn't yet execute remote
  commands. Extending `heartbeat`'s response with a command queue (push
  config, reboot, rotate WireGuard keys) is the natural next step once the
  basics are proven in the field.
- WireGuard keys are generated server-side and handed to the router in the
  script (simplest for a fully automated one-shot setup). Rotating a
  compromised device's key means re-running "Get setup script" — a
  self-rotating key exchange is a hardening item, not a blocker for launch.
