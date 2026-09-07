// TalkSasa SMS client (https://talksasa.com). Confirmed working against the
// real account via the admin portal's "Send test message" button — endpoint
// path and field names below are verified, not guessed.

export interface SendSmsInput {
  apiKey: string;
  senderId: string;
  to: string; // any common Kenyan format — normalized before sending, see below
  message: string;
}

export interface SendSmsResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

const TALKSASA_ENDPOINT = "https://bulksms.talksasa.com/api/v3/sms/send";

// TalkSasa only accepts bare-254 MSISDNs (254768557160) — not +254768557160
// and not the local 0768557160 format the captive portal's phone input
// collects (placeholder is literally "07XXXXXXXX"). Centralized here so
// every caller (voucher/receipt SMS, the admin's manual test-send) gets it
// for free instead of each one needing to remember to normalize.
function normalizeKenyanMsisdn(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "254" + digits.slice(1);
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return "254" + digits;
  return digits; // unrecognized shape — best effort, send as-is rather than block
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  try {
    const res = await fetch(TALKSASA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        recipient: normalizeKenyanMsisdn(input.to),
        sender_id: input.senderId,
        message: input.message,
        type: "plain",
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `TalkSasa ${res.status}: ${JSON.stringify(json)}` };
    }
    return { ok: true, providerRef: json.message_id ?? json.id ?? undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
