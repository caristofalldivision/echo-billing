import { supabaseAdmin, getOrgSettings } from "./supabase.ts";
import { requestToken, ensureIpnRegistered, submitOrder } from "./pesapal.ts";

export interface InitiatePurchaseInput {
  planId: string;
  phone: string;
  email?: string;
  mikrotikDeviceId?: string;
  // window.location.origin captured client-side before the full-page
  // redirect to Pesapal — the captive portal is served locally by the
  // router (a LAN address our backend has no other way to know), and this
  // is what lets the return page send the browser back to the actual
  // login page instead of stranding it on a generic "payment received"
  // screen it can't navigate on from.
  returnOrigin?: string;
}

export async function initiatePurchase(input: InitiatePurchaseInput) {
  const supabase = supabaseAdmin();
  const org = await getOrgSettings();

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("id", input.planId)
    .eq("is_active", true)
    .single();
  if (planError || !plan) throw new Error("Plan not found or inactive");

  const merchantReference = `echo_${crypto.randomUUID()}`;
  const functionsBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

  const { data: customer } = await supabase
    .from("customers")
    .upsert(
      { org_id: org.id, phone: input.phone, email: input.email ?? null },
      { onConflict: "org_id,phone" },
    )
    .select()
    .single();

  const { data: txn, error: txnError } = await supabase
    .from("transactions")
    .insert({
      org_id: org.id,
      customer_id: customer?.id ?? null,
      plan_id: plan.id,
      amount: plan.price,
      currency: plan.currency,
      method: "mpesa_stk",
      status: "pending",
      phone: input.phone,
      pesapal_merchant_reference: merchantReference,
    })
    .select()
    .single();
  if (txnError || !txn) throw new Error(`Could not create transaction: ${txnError?.message}`);

  const token = await requestToken(org);
  const ipnId = await ensureIpnRegistered(
    org,
    token,
    `${functionsBase}/pesapal-ipn`,
    async (id) => {
      await supabase.from("organizations").update({ pesapal_ipn_id: id }).eq("id", org.id);
    },
  );

  // Redirect straight back to the captive portal's own login.html when we
  // know its address (always true for a real captive-portal purchase) —
  // no intermediate page. The OS-level captive-portal mini-browser most
  // phones open a hotspot login in (Apple's Captive Network Assistant,
  // Android's equivalent) is known to handle chained redirects/meta-refresh/
  // JS navigation badly; every extra hop is a place for it to strand the
  // customer on an unrendered page instead of getting them back. Falls back
  // to the portal-api/return page only when we don't have an origin (not
  // expected from the real flow, but keeps this from hard-failing).
  const callbackUrl = input.returnOrigin
    ? `${input.returnOrigin}/login.html?transactionId=${txn.id}`
    : `${functionsBase}/portal-api/return?ref=${merchantReference}`;

  const order = await submitOrder(org, token, {
    merchantReference,
    amount: Number(plan.price),
    currency: plan.currency,
    description: `Echo — ${plan.name}`,
    callbackUrl,
    ipnId,
    phone: input.phone,
    email: input.email,
  });

  await supabase
    .from("transactions")
    .update({ pesapal_order_tracking_id: order.order_tracking_id })
    .eq("id", txn.id);

  return {
    transactionId: txn.id,
    merchantReference,
    orderTrackingId: order.order_tracking_id,
    redirectUrl: order.redirect_url,
  };
}
