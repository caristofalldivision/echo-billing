// Shared by pesapal-ipn (push: Pesapal calls us) and portal-api's /status
// route (pull: the captive portal polls us). Sandbox/demo Pesapal accounts
// have been observed to never fire the IPN webhook at all, which left
// customers who'd genuinely paid stuck polling a transaction that would
// never flip to "completed" — this lets the client's own poll actively
// re-verify with Pesapal and fulfill immediately, instead of only ever
// waiting on a webhook that may not arrive. Both callers re-fetch the
// authoritative status from Pesapal before fulfilling anything; neither
// ever trusts a webhook payload or a client's say-so.
import { requestToken, getTransactionStatus } from "./pesapal.ts";
import { generateVoucherCode } from "./vouchers.ts";
import { sendSms } from "./sms.ts";
import { sendEmail, receiptEmailHtml } from "./email.ts";

// deno-lint-ignore no-explicit-any
export async function reconcileTransaction(supabase: any, org: any, txn: any): Promise<void> {
  // Idempotency guard — may be called more than once for the same
  // transaction (Pesapal retries IPNs; the client polls every few seconds).
  if (txn.status === "completed" || txn.status === "failed") return;
  if (!txn.pesapal_order_tracking_id) return; // order not even submitted yet

  const token = await requestToken(org);
  const status = await getTransactionStatus(org, token, txn.pesapal_order_tracking_id);

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

    // Receipt notifications — best-effort, never block fulfillment on these.
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
        reference: txn.pesapal_merchant_reference,
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
}
