// Admin-triggered order creation (e.g. "charge this customer manually" from
// the admin portal). The captive portal's own purchase flow goes through
// `portal-api` instead, which shares this same logic via _shared/purchase.ts.
// Requires a Supabase auth JWT belonging to an actual admin_users member of
// this org — verify_jwt=true at the gateway only proves the caller has *a*
// Supabase account, not that they're one of ours (see the long comment in
// voucher-generate/index.ts). Without this, anyone with any Supabase
// account could trigger arbitrary Pesapal orders/STK pushes through this
// org's account.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { getCallerAdmin } from "../_shared/auth.ts";
import { initiatePurchase } from "../_shared/purchase.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });

    const body = await req.json();
    if (!body.planId || !body.phone) {
      return withCors({ error: "planId and phone are required" }, { status: 400 });
    }
    const result = await initiatePurchase({
      planId: body.planId,
      phone: body.phone,
      email: body.email,
      mikrotikDeviceId: body.mikrotikDeviceId,
    });
    return withCors(result);
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
