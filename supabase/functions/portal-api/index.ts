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
import { reconcileTransaction } from "../_shared/fulfillment.ts";
import { normalizeVoucherCode } from "../_shared/vouchers.ts";

// Every single hotspot connection hits /theme and /plans on page load
// (main.js's applyBranding() + loadPlans(), both fired immediately) — by
// far the hottest read path in the whole system, for data that only
// changes when an admin edits it from Settings. Cached in-memory per warm
// isolate (same pattern as pesapal.ts's token cache) rather than reaching
// for external infra like Redis: a single-org deployment's read volume
// here doesn't need a shared cache tier, and this avoids a DB round trip
// for the common case entirely. 30s TTL keeps admin edits (a new plan
// price, a theme tweak) showing up within one short wait, not stale
// indefinitely, while still collapsing a router's worth of near-simultaneous
// connections onto a single query.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: unknown; expiresAt: number }>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data as T;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();

  try {
    if (route === "theme" && req.method === "GET") {
      const data = await cached("theme", async () => {
        const supabase = supabaseAdmin();
        const { data } = await supabase
          .from("captive_portal_themes")
          .select("*")
          .is("mikrotik_device_id", null)
          .maybeSingle();
        return data ?? null;
      });
      return withCors({ theme: data });
    }

    if (route === "plans" && req.method === "GET") {
      const type = url.searchParams.get("type") ?? "";
      const data = await cached(`plans:${type}`, async () => {
        const supabase = supabaseAdmin();
        let query = supabase.from("plans").select("*").eq("is_active", true).order("price");
        if (type) query = query.eq("type", type);
        const { data, error } = await query;
        if (error) throw error;
        return data;
      });
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
        returnOrigin: body.returnOrigin,
      });
      return withCors(result);
    }

    if (route === "status" && req.method === "GET") {
      const transactionId = url.searchParams.get("transactionId");
      if (!transactionId) return withCors({ error: "transactionId is required" }, { status: 400 });
      const supabase = supabaseAdmin();
      const { data: txn, error } = await supabase
        .from("transactions")
        .select("*, plans(*), customers(*), vouchers!transactions_voucher_id_fkey(code)")
        .eq("id", transactionId)
        .single();
      if (error || !txn) return withCors({ error: "Transaction not found" }, { status: 404 });

      // Don't just passively read the DB — sandbox/demo Pesapal accounts
      // have been observed to never call the IPN webhook at all, which
      // would otherwise leave a customer who genuinely paid stuck polling
      // a transaction that never flips to "completed". Actively re-verify
      // with Pesapal on every poll while still pending, same idempotent
      // re-verified fulfillment path the webhook uses — this is what makes
      // confirmation land within one poll interval instead of depending on
      // a webhook that may not arrive.
      if (txn.status !== "completed" && txn.status !== "failed") {
        try {
          const org = await getOrgSettings(txn.org_id);
          await reconcileTransaction(supabase, org, txn);
        } catch (err) {
          console.error("status reconcile error", err);
          // Swallow — a failed active re-check shouldn't break polling,
          // the client just tries again on the next interval.
        }
      }

      const { data: fresh } = await supabase
        .from("transactions")
        .select("status, vouchers!transactions_voucher_id_fkey(code)")
        .eq("id", transactionId)
        .single();

      return withCors({
        status: fresh?.status ?? txn.status,
        voucherCode: (fresh as unknown as { vouchers: { code: string } | null } | null)?.vouchers?.code,
      });
    }

    if (route === "check-voucher" && req.method === "POST") {
      const { code } = await req.json();
      if (!code) return withCors({ error: "code is required" }, { status: 400 });
      const supabase = supabaseAdmin();
      const { data: voucher } = await supabase
        .from("vouchers")
        .select("*, plans(name, duration_minutes, data_cap_mb)")
        .eq("code", normalizeVoucherCode(code))
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
      const ref = url.searchParams.get("ref");
      const origin = url.searchParams.get("origin");

      // This is a full-page redirect target, not a popup — MikroTik hotspot
      // logins are typically opened inside the OS's restricted captive-portal
      // mini-browser (Apple's Captive Network Assistant, Android's
      // equivalent), which is known to block/mishandle window.open(). A
      // plain top-level redirect here and back is what actually works there.
      //
      // Also a third chance to reconcile (alongside the IPN webhook and the
      // captive portal's own poll) — sandbox/demo accounts have been seen to
      // never call the webhook, so checking right here, on the one request
      // we know definitely happens, matters. Awaited, not backgrounded: this
      // route is hit at most once per transaction (not a hot polling path
      // like /status), so there's no latency budget worth protecting here —
      // and backgrounding it would mean the redirect response can go out,
      // and the mini-browser can be closed, before fulfillment actually
      // finishes running.
      let txnId: string | null = null;
      const heading = "Payment received";
      const message = "Confirming and connecting you…";
      if (ref) {
        try {
          const supabase = supabaseAdmin();
          const { data: txn } = await supabase
            .from("transactions")
            .select("*, plans(*), customers(*)")
            .eq("pesapal_merchant_reference", ref)
            .single();
          if (txn) {
            txnId = txn.id;
            if (txn.status !== "completed" && txn.status !== "failed") {
              await reconcileTransaction(supabase, org, txn);
            }
          }
        } catch (err) {
          console.error("return-page reconcile error", err);
        }
      }

      // Send the browser straight back to the captive portal's own
      // login.html (served locally by the router — origin came from
      // window.location.origin captured before we ever left it), carrying
      // the transaction id so it can resume polling immediately instead of
      // showing the plan list again. Without a known origin (shouldn't
      // happen from a real captive-portal purchase, but don't hard-fail),
      // just show the status message with nothing to navigate to.
      const target = origin && txnId ? `${origin}/login.html?transactionId=${txnId}` : null;

      const html = `<!doctype html><html><head><meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>${org.name}</title>
        ${target ? `<meta http-equiv="refresh" content="0; url=${target}">` : ""}
        <style>
          body { font-family: -apple-system, Segoe UI, sans-serif; background: ${org.brand_primary_color}; color: #fff;
                 display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .card { background: rgba(255,255,255,0.12); padding: 32px; border-radius: 20px; max-width: 320px; }
        </style></head>
        <body><div class="card">
          <h2>${heading}</h2>
          <p>${message}</p>
        </div>
        ${target ? `<script>window.location.replace(${JSON.stringify(target)});</script>` : ""}
        </body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("portal-api error", err);
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
