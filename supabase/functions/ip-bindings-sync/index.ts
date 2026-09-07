// Fetched periodically by a router's own `/tool fetch` (a dedicated
// echo-ip-sync scheduler, separate from the echo-heartbeat one — see
// _shared/router-template.ts) — not called from the admin portal. Public,
// authenticated by the device's own provisioning_token, same as
// provisioning-fetch and heartbeat.
//
// Renders RouterOS script text (not JSON) that replaces every
// comment="echo-allowlist" ip-binding with the org's current allowlist for
// this device — full-replace each sync rather than diffing, which is
// simplest-correct for a small, admin-managed list and never touches any
// binding without that exact comment tag.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401, headers: corsHeaders });

  const supabase = supabaseAdmin();
  const { data: device, error } = await supabase
    .from("mikrotik_devices")
    .select("id")
    .eq("provisioning_token", token)
    .single();
  if (error || !device) return new Response("Unknown device token", { status: 404, headers: corsHeaders });

  const { data: entries } = await supabase
    .from("ip_allowlist")
    .select("ip_address")
    .eq("mikrotik_device_id", device.id);

  // ip_address is Postgres `inet`, already validated on the way in — safe
  // to interpolate directly, no user-provided free text (label) goes
  // anywhere near this script.
  const addLines = (entries ?? [])
    .map((e) => `/ip hotspot ip-binding add address=${e.ip_address} type=bypassed comment="echo-allowlist"`)
    .join("\n");

  const script = `/ip hotspot ip-binding remove [find comment="echo-allowlist"]
${addLines}
`;

  return new Response(script, {
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
});
