# Echo edge functions

| Function | Auth | Purpose |
|---|---|---|
| `portal-api` | public | Everything the captive portal calls: plans, purchase, status polling, voucher check, Pesapal return page |
| `pesapal-initiate` | Supabase JWT | Admin-triggered manual charge |
| `pesapal-ipn` | public (Pesapal calls this) | Payment webhook — confirms status, fulfills (voucher/PPPoE extension), sends receipt SMS/email |
| `sms-send` | Supabase JWT | Admin-triggered manual SMS |
| `email-send` | Supabase JWT | Admin-triggered manual email |
| `voucher-generate` | Supabase JWT | Batch voucher creation |
| `provisioning-script` | Supabase JWT | Generates a device's WireGuard identity + renders its RouterOS setup script |
| `heartbeat` | public (device token) | Router scheduler check-in |

## Secrets (`supabase secrets set KEY=value`)

- `WIREGUARD_SERVER_PUBKEY` — public key of the radius-service WireGuard concentrator
- `WIREGUARD_SERVER_ENDPOINT` — `host:port` routers dial, e.g. `radius.yourdomain.com:51820`
- `RADIUS_SHARED_SECRET` — shared secret between routers and radius-service
- Pesapal/TalkSasa/Resend credentials are **not** function secrets — they're stored per-org in the `organizations` table and set from the admin portal's Settings pages, so they can be edited without a redeploy.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase platform for edge functions — no need to set them yourself.

## Local testing

```bash
supabase functions serve
curl http://localhost:54321/functions/v1/portal-api/plans
```
