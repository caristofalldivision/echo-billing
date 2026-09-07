// Admin-triggered batch voucher generation. Requires a Supabase auth JWT
// belonging to an actual admin_users member of this org — verify_jwt=true
// at the gateway only proves the caller has *a* Supabase account, not that
// they're one of ours, and Supabase's own signup API isn't gated by the
// Next.js /signup page's "already set up" check (that's app-level UI, not
// an Auth-level restriction). Without this, anyone who can create any
// Supabase auth account could mint free vouchers.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";
import { generateVoucherCode } from "../_shared/vouchers.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });

    const { planId, quantity, mikrotikDeviceId, expiresInDays } = await req.json();
    const qty = Math.min(Math.max(Number(quantity) || 1, 1), 1000);
    if (!planId) return withCors({ error: "planId is required" }, { status: 400 });

    const supabase = supabaseAdmin();

    const batchId = crypto.randomUUID();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const rows = Array.from({ length: qty }, () => ({
      org_id: caller.org_id,
      code: generateVoucherCode(),
      plan_id: planId,
      mikrotik_device_id: mikrotikDeviceId ?? null,
      batch_id: batchId,
      status: "unused" as const,
      expires_at: expiresAt,
      created_by: caller.id,
    }));

    const { data, error } = await supabase.from("vouchers").insert(rows).select();
    if (error) throw error;

    return withCors({ batchId, count: data.length, vouchers: data });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
