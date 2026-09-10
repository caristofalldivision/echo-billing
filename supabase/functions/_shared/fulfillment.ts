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
import { runInBackground } from "./background.ts";

// deno-lint-ignore no-explicit-any
export async function reconcileTransaction(supabase: any, org: any, txn: any): Promise<void> {
  // Idempotency guard — may be called more than once for the same
  // transaction (Pesapal retries IPNs; the client polls every few seconds).
  if (txn.status === "completed" || txn.status === "failed") return;
  if (!txn.pesapal_order_tracking_id) return; // order not even submitted yet

  const token = await requestToken(org);
  const status = await getTransactionStatus(org, token, txn.pesapal_order_tracking_id);

  if (status.payment_status_description === "Completed") {
    // Atomic claim: only proceed if this call is the one that actually
    // flips pending -> completed. Two concurrent callers (the IPN webhook
    // landing the same moment as a /status poll, say) could otherwise both
    // pass the txn.status check above and both fall through to issuing a
    // voucher / extending a PPPoE account for the same payment. The WHERE
    // clause here makes Postgres's row lock during the UPDATE do the
    // serializing, the same idiom already used for voucher claims.
    const { data: claimed } = await supabase
      .from("transactions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", txn.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (!claimed) return; // another concurrent call already completed this transaction

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

    // Receipt notifications are best-effort and shouldn't add their own
    // latency to /status or /return's response — dispatched in the
    // background so SMS/email fire immediately without the caller waiting
    // on TalkSasa/Resend round-trips.
    runInBackground(() => sendReceiptNotifications(supabase, org, txn, voucherCode));
  } else if (status.payment_status_description === "Failed") {
    // Not immediately trusted — found live 2026-09-10: a transaction polled
    // via /status seconds after creation got back "Failed" from Pesapal's
    // sandbox, got written here as terminal, and was then never re-checked
    // again (the guard above skips anything already "failed" or
    // "completed") — even though the customer's M-Pesa PIN prompt hadn't
    // resolved yet. Re-querying that same order_tracking_id directly
    // afterward showed Pesapal had since flipped it to "Completed" with a
    // real confirmation code — the payment went through, but the customer
    // got no voucher, no SMS, and no way to recover, because we'd already
    // called it dead. /status polls every 3s starting immediately after
    // purchase creation, so it's very likely to catch Pesapal mid-flight
    // before the STK push has even been acted on — giving it a grace
    // window before accepting "Failed" as authoritative costs nothing
    // (reconcile-pending's 1-minute sweep keeps checking regardless) and
    // avoids exactly this false-negative.
    const ageMs = Date.now() - new Date(txn.created_at).getTime();
    const FAILURE_GRACE_MS = 45_000;
    if (ageMs > FAILURE_GRACE_MS) {
      await supabase
        .from("transactions")
        .update({ status: "failed" })
        .eq("id", txn.id)
        .eq("status", "pending");
    }
  }
}

// deno-lint-ignore no-explicit-any
async function sendReceiptNotifications(supabase: any, org: any, txn: any, voucherCode?: string): Promise<void> {
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
}
