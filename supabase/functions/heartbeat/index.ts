// Called periodically by the RouterOS scheduler task set up during
// provisioning (see _shared/router-template.ts). Authenticates with the
// device's provisioning_token as a bearer token — not a Supabase user JWT,
// so this function is in the public list in supabase/config.toml.
//
// Follow-up: this is currently a liveness ping only. A remote-command queue
// (e.g. "push updated hotspot profile", "reboot") would extend the response
// body with a `commands` array for the router script to act on.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return withCors({ error: "Missing provisioning token" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: device, error } = await supabase
    .from("mikrotik_devices")
    .select("id, status")
    .eq("provisioning_token", token)
    .single();
  if (error || !device) return withCors({ error: "Unknown device token" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  await supabase
    .from("mikrotik_devices")
    .update({
      status: "linked",
      last_seen_at: new Date().toISOString(),
      ...(body.model ? { model: body.model } : {}),
      ...(body.routeros_version ? { routeros_version: body.routeros_version } : {}),
    })
    .eq("id", device.id);

  return withCors({ ok: true, commands: [] });
});
