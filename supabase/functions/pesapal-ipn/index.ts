// Pesapal calls this webhook (GET or POST, query-string params) after a
// transaction reaches a final state. We never trust the payload alone — we
// re-fetch the authoritative status from Pesapal before fulfilling anything.
//
// Fulfillment model:
//   - hotspot plan  -> generate a voucher, text + email the code. The code
//     doubles as the hotspot login (RADIUS checks the `vouchers` table).
//   - pppoe plan    -> extend the customer's pppoe_accounts.expires_at.
import { withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { requestToken, getTransactionStatus } from "../_shared/pesapal.ts";
import { generateVoucherCode } from "../_shared/vouchers.ts";
import { sendSms } from "../_shared/sms.ts";
import { sendEmail, receiptEmailHtml } from "../_shared/email.ts";

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
    const token = await requestToken(org);
    const status = await getTransactionStatus(org, token, orderTrackingId);

    const { data: txn } = await supabase
      .from("transactions")
      .select("*, plans(*), customers(*)")
      .eq("pesapal_merchant_reference", merchantReference)
      .single();

    if (!txn) {
      return withCors(pesapalAck(orderTrackingId, merchantReference));
    }

    // Idempotency guard — Pesapal may call the IPN more than once.
    if (txn.status === "completed") {
      return withCors(pesapalAck(orderTrackingId, merchantReference));
    }

    if (status.payment_status_description === "Completed") {
      await supabase
        .from("transactions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", txn.id);

      let voucherCode: string | undefined;

      if (txn.plans.type === "hotspot") {
        voucherCode = generateVoucherCode();
        const { data: voucher } = await supabase
          .from("vouchers")
          .insert({
            org_id: org.id,
            code: voucherCode,
            plan_id: txn.plan_id,
            status: "unused",
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select()
          .single();
        if (voucher) {
          await supabase.from("transactions").update({ voucher_id: voucher.id }).eq("id", txn.id);
        }
      } else if (txn.plans.type === "pppoe" && txn.customer_id) {
        const durationMs = (txn.plans.duration_minutes ?? 43200) * 60 * 1000; // default 30 days
        const { data: account } = await supabase
          .from("pppoe_accounts")
          .select("*")
          .eq("customer_id", txn.customer_id)
          .maybeSingle();
        const newExpiry = new Date(
          Math.max(Date.now(), new Date(account?.expires_at ?? 0).getTime()) + durationMs,
        ).toISOString();

        if (account) {
          await supabase
            .from("pppoe_accounts")
            .update({ status: "active", expires_at: newExpiry, plan_id: txn.plan_id })
            .eq("id", account.id);
        }
      }

      // Receipt notifications — best-effort, never block the IPN ack on these.
      if (txn.phone && org.talksasa_api_key) {
        const message = voucherCode
          ? `Echo: Payment received for ${txn.plans.name}. Your WiFi code is ${voucherCode}.`
          : `Echo: Payment received for ${txn.plans.name}. Your account has been renewed.`;
        const result = await sendSms({
          apiKey: org.talksasa_api_key,
          senderId: org.talksasa_sender_id ?? "ECHO",
          to: txn.phone,
          message,
        });
        await supabase.from("sms_logs").insert({
          org_id: org.id,
          recipient_phone: txn.phone,
          template: "payment_receipt",
          message,
          status: result.ok ? "sent" : "failed",
          provider_ref: result.providerRef,
          error: result.error,
        });
      }

      if (txn.customers?.email && org.resend_api_key) {
        const html = receiptEmailHtml({
          orgName: org.name,
          primaryColor: org.brand_primary_color,
          planName: txn.plans.name,
          amount: txn.amount,
          currency: txn.currency,
          reference: merchantReference,
          voucherCode,
        });
        const result = await sendEmail({
          apiKey: org.resend_api_key,
          from: `${org.resend_from_name} <${org.resend_from_email}>`,
          to: txn.customers.email,
          subject: "Payment received",
          html,
        });
        await supabase.from("email_logs").insert({
          org_id: org.id,
          recipient_email: txn.customers.email,
          template: "payment_receipt",
          subject: "Payment received",
          status: result.ok ? "sent" : "failed",
          provider_ref: result.providerRef,
          error: result.error,
        });
      }
    } else if (status.payment_status_description === "Failed") {
      await supabase.from("transactions").update({ status: "failed" }).eq("id", txn.id);
    }

    return withCors(pesapalAck(orderTrackingId, merchantReference));
  } catch (err) {
    console.error("pesapal-ipn error", err);
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
