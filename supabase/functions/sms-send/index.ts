// Admin-triggered SMS (manual notices, test sends). Requires a Supabase auth
// JWT — see supabase/config.toml (this function is NOT in the public list).
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { sendSms } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const { to, message, template } = await req.json();
    if (!to || !message) return withCors({ error: "to and message are required" }, { status: 400 });

    const org = await getOrgSettings();
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
