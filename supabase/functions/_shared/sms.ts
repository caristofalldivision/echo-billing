// TalkSasa SMS client (https://talksasa.com).
//
// NOTE: verify this against your TalkSasa dashboard's API docs before relying
// on it in production — endpoint path and field names below follow their
// published v3 REST pattern (Bearer token, JSON body) but sender IDs and
// exact response shape are account-specific. Adjust `endpoint`/field names
// if your account's docs differ.

export interface SendSmsInput {
  apiKey: string;
  senderId: string;
  to: string; // MSISDN, e.g. 2547XXXXXXXX
  message: string;
}

export interface SendSmsResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

const TALKSASA_ENDPOINT = "https://bulksms.talksasa.com/api/v3/sms/send";

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
        recipient: input.to,
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
