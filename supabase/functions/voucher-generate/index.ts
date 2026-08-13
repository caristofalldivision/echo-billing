// Admin-triggered batch voucher generation. Requires a Supabase auth JWT.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { generateVoucherCode } from "../_shared/vouchers.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const { planId, quantity, mikrotikDeviceId, expiresInDays } = await req.json();
    const qty = Math.min(Math.max(Number(quantity) || 1, 1), 1000);
    if (!planId) return withCors({ error: "planId is required" }, { status: 400 });

    const org = await getOrgSettings();
    const supabase = supabaseAdmin();

    const batchId = crypto.randomUUID();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const rows = Array.from({ length: qty }, () => ({
      org_id: org.id,
      code: generateVoucherCode(),
      plan_id: planId,
      mikrotik_device_id: mikrotikDeviceId ?? null,
      batch_id: batchId,
      status: "unused" as const,
      expires_at: expiresAt,
    }));

    const { data, error } = await supabase.from("vouchers").insert(rows).select();
    if (error) throw error;

    return withCors({ batchId, count: data.length, vouchers: data });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
