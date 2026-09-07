// Pesapal calls this webhook (GET or POST, query-string params) after a
// transaction reaches a final state. We never trust the payload alone — we
// re-fetch the authoritative status from Pesapal before fulfilling anything.
// Fulfillment logic itself lives in ../_shared/fulfillment.ts, shared with
// portal-api's /status route — sandbox/demo Pesapal accounts have been
// observed to never actually call this webhook, so the client's own poll
// needs to be able to reconcile and fulfill too, not just this handler.
import { withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { reconcileTransaction } from "../_shared/fulfillment.ts";

function pesapalAck(orderTrackingId: string, merchantReference: string) {
  return {
    orderNotificationType: "IPNCHANGE",
    orderTrackingId,
    orderMerchantReference: merchantReference,
    status: 200,
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const orderTrackingId =
    url.searchParams.get("OrderTrackingId") ?? url.searchParams.get("orderTrackingId");
  const merchantReference =
    url.searchParams.get("OrderMerchantReference") ?? url.searchParams.get("orderMerchantReference");

  if (!orderTrackingId || !merchantReference) {
    return withCors({ error: "Missing OrderTrackingId/OrderMerchantReference" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const org = await getOrgSettings();

  try {
    const { data: txn } = await supabase
      .from("transactions")
      .select("*, plans(*), customers(*)")
      .eq("pesapal_merchant_reference", merchantReference)
      .single();

    if (!txn) {
      return withCors(pesapalAck(orderTrackingId, merchantReference));
    }

    await reconcileTransaction(supabase, org, txn);

    return withCors(pesapalAck(orderTrackingId, merchantReference));
  } catch (err) {
    console.error("pesapal-ipn error", err);
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
