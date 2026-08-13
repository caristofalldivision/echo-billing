// Resend email client (https://resend.com/docs/api-reference/emails/send-email)

export interface SendEmailInput {
  apiKey: string;
  from: string; // "Echo <billing@yourdomain.com>"
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(json)}` };
    }
    return { ok: true, providerRef: json.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function receiptEmailHtml(opts: {
  orgName: string;
  primaryColor: string;
  planName: string;
  amount: number;
  currency: string;
  reference: string;
  voucherCode?: string;
}) {
  return `
  <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <h1 style="color: ${opts.primaryColor}; font-size: 22px;">Payment received</h1>
    <p style="color: #333; font-size: 15px; line-height: 1.5;">
      Thanks for your payment to <strong>${opts.orgName}</strong>.
    </p>
    <table style="width: 100%; margin: 20px 0; font-size: 14px; color: #333;">
      <tr><td style="padding: 6px 0; color: #888;">Plan</td><td style="text-align: right;">${opts.planName}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">Amount</td><td style="text-align: right;">${opts.currency} ${opts.amount}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">Reference</td><td style="text-align: right;">${opts.reference}</td></tr>
      ${opts.voucherCode ? `<tr><td style="padding: 6px 0; color: #888;">Voucher code</td><td style="text-align: right; font-weight: bold;">${opts.voucherCode}</td></tr>` : ""}
    </table>
    <p style="color: #999; font-size: 12px;">Sent by Echo billing.</p>
  </div>`;
}
