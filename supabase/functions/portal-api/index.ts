// Public API consumed by the captive portal running on the router
// (apps/captive-portal). No Supabase auth JWT — this is the internet-facing
// surface, so every branch does its own scoping/validation. Routes are
// dispatched on the last URL path segment:
//
//   GET  /portal-api/theme
//   GET  /portal-api/plans?type=hotspot|pppoe
//   POST /portal-api/purchase        { planId, phone, email? }
//   GET  /portal-api/status?transactionId=...
//   POST /portal-api/check-voucher   { code }
//   GET  /portal-api/return?ref=...  (Pesapal browser redirect target, returns HTML)
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { initiatePurchase } from "../_shared/purchase.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();

  try {
    if (route === "theme" && req.method === "GET") {
      const supabase = supabaseAdmin();
      const { data } = await supabase
        .from("captive_portal_themes")
        .select("*")
        .is("mikrotik_device_id", null)
        .maybeSingle();
      return withCors({ theme: data ?? null });
    }

    if (route === "plans" && req.method === "GET") {
      const type = url.searchParams.get("type");
      const supabase = supabaseAdmin();
      let query = supabase.from("plans").select("*").eq("is_active", true).order("price");
      if (type) query = query.eq("type", type);
      const { data, error } = await query;
      if (error) throw error;
      return withCors({ plans: data });
    }

    if (route === "purchase" && req.method === "POST") {
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
    }

    if (route === "status" && req.method === "GET") {
      const transactionId = url.searchParams.get("transactionId");
      if (!transactionId) return withCors({ error: "transactionId is required" }, { status: 400 });
      const supabase = supabaseAdmin();
      const { data: txn, error } = await supabase
        .from("transactions")
        .select("status, voucher_id, vouchers(code)")
        .eq("id", transactionId)
        .single();
      if (error || !txn) return withCors({ error: "Transaction not found" }, { status: 404 });
      return withCors({
        status: txn.status,
        voucherCode: (txn as unknown as { vouchers: { code: string } | null }).vouchers?.code,
      });
    }

    if (route === "check-voucher" && req.method === "POST") {
      const { code } = await req.json();
      if (!code) return withCors({ error: "code is required" }, { status: 400 });
      const supabase = supabaseAdmin();
      const { data: voucher } = await supabase
        .from("vouchers")
        .select("*, plans(name, duration_minutes, data_cap_mb)")
        .eq("code", code.toUpperCase())
        .maybeSingle();

      if (!voucher) return withCors({ valid: false, reason: "not_found" });
      if (voucher.status !== "unused") return withCors({ valid: false, reason: voucher.status });
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return withCors({ valid: false, reason: "expired" });
      }
      return withCors({ valid: true, plan: voucher.plans });
    }

    if (route === "return" && req.method === "GET") {
      const org = await getOrgSettings();
      const html = `<!doctype html><html><head><meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>${org.name}</title>
        <style>
          body { font-family: -apple-system, Segoe UI, sans-serif; background: ${org.brand_primary_color}; color: #fff;
                 display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .card { background: rgba(255,255,255,0.12); padding: 32px; border-radius: 20px; max-width: 320px; }
        </style></head>
        <body><div class="card">
          <h2>Payment received</h2>
          <p>Go back to the WiFi login page — your access code will be there or arriving by SMS shortly.</p>
        </div></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("portal-api error", err);
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
