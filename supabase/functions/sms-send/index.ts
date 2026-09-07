// Admin-triggered SMS (manual notices, test sends). Requires a Supabase auth
// JWT belonging to an actual admin_users member of this org — verify_jwt=true
// at the gateway only proves the caller has *a* Supabase account, not that
// they're one of ours (see the long comment in voucher-generate/index.ts).
// Without this, anyone with any Supabase account could send SMS on this
// org's TalkSasa bill.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";
import { sendSms } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });

    const { to, message, template } = await req.json();
    if (!to || !message) return withCors({ error: "to and message are required" }, { status: 400 });

    const org = await getOrgSettings(caller.org_id);
    if (!org.talksasa_api_key) {
      return withCors({ error: "TalkSasa is not configured for this organization" }, { status: 400 });
    }

    const result = await sendSms({
      apiKey: org.talksasa_api_key,
      senderId: org.talksasa_sender_id ?? "ECHO",
      to,
      message,
    });

    const supabase = supabaseAdmin();
    await supabase.from("sms_logs").insert({
      org_id: org.id,
      recipient_phone: to,
      template: template ?? "manual",
      message,
      status: result.ok ? "sent" : "failed",
      provider_ref: result.providerRef,
      error: result.error,
    });

    if (!result.ok) return withCors({ error: result.error }, { status: 502 });
    return withCors({ ok: true, providerRef: result.providerRef });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
