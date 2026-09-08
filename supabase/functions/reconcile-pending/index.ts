// Safety-net sweep for pending Pesapal transactions where none of the other
// three fulfillment triggers (IPN webhook, /status poll, /return redirect)
// ever ran to completion — e.g. the captive-portal mini-browser was closed
// before the client could resume polling after the M-Pesa redirect, and
// Pesapal's sandbox/demo IPN is known to sometimes never fire at all (see
// CLAUDE.md). Invoked every minute by pg_cron + pg_net (see migration
// 0009_reconcile_pending_sweep.sql) — public like the other router/webhook-
// facing functions, since pg_net has no way to carry a signed-in admin's
// JWT. Nothing here is abusable by an anonymous caller: it only re-verifies
// and fulfills transactions that already exist in our own DB as pending,
// via the same idempotent, re-verified reconcileTransaction() used
// everywhere else.
import { withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { reconcileTransaction } from "../_shared/fulfillment.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const supabase = supabaseAdmin();

  // Bounded to the last 2 hours — an STK push either resolves within
  // minutes or the customer has long since walked away; there's no value
  // in re-checking Pesapal for a checkout abandoned hours or days ago on
  // every tick forever.
  const { data: pending, error } = await supabase
    .from("transactions")
    .select("*, plans(*), customers(*)")
    .eq("status", "pending")
    .not("pesapal_order_tracking_id", "is", null)
    .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("reconcile-pending sweep query error", error);
    return withCors({ error: error.message }, { status: 500 });
  }

  let reconciled = 0;
  for (const txn of pending ?? []) {
    try {
      const org = await getOrgSettings(txn.org_id);
      await reconcileTransaction(supabase, org, txn);
      reconciled++;
    } catch (err) {
      console.error("reconcile-pending sweep error", txn.id, err);
    }
  }

  return withCors({ checked: pending?.length ?? 0, reconciled });
});
