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

  const returnParams = new URLSearchParams({ ref: merchantReference });
  if (input.returnOrigin) returnParams.set("origin", input.returnOrigin);

  const order = await submitOrder(org, token, {
    merchantReference,
    amount: Number(plan.price),
    currency: plan.currency,
    description: `Echo — ${plan.name}`,
    callbackUrl: `${functionsBase}/portal-api/return?${returnParams.toString()}`,
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
