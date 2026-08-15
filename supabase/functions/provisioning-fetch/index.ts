// Fetched directly by a router's own `/tool fetch` during the bootstrap
// step (see renderBootstrapScript in _shared/router-template.ts) — not
// called from the admin portal. Public (no Supabase JWT — a RouterOS
// `/tool fetch` can't produce one), authenticated instead by the device's
// own provisioning_token, the same secret already used for heartbeat.
//
// Re-renders from whatever is currently stored on the device row rather
// than generating new WireGuard/API credentials, so re-running the
// bootstrap on the router always fetches the script matching its current
// state instead of silently rotating keys out from under it.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { renderRouterScript } from "../_shared/router-template.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401, headers: corsHeaders });

  const wireguardServerEndpoint = Deno.env.get("WIREGUARD_SERVER_ENDPOINT");
  const radiusSecret = Deno.env.get("RADIUS_SHARED_SECRET");
  if (!wireguardServerEndpoint || !radiusSecret) {
    return new Response("radius-service isn't deployed yet", { status: 500, headers: corsHeaders });
  }

  const supabase = supabaseAdmin();
  const { data: device, error } = await supabase
    .from("mikrotik_devices")
    .select("*")
    .eq("provisioning_token", token)
    .single();
  if (error || !device) return new Response("Unknown device token", { status: 404, headers: corsHeaders });
  if (!device.wireguard_client_privkey) {
    return new Response(
      "This device hasn't had a setup script generated yet — click \"Get setup script\" in the admin portal first.",
      { status: 409, headers: corsHeaders },
    );
  }

  // Postgres's `inet` type omits the netmask from its text output when it's
  // the address family's maximum (/32 for IPv4) — round-tripping through
  // the column can silently drop the suffix RouterOS requires on `/ip
  // address add`, even though it was stored with "/32" originally.
  const wireguardTunnelIp = String(device.wireguard_tunnel_ip).includes("/")
    ? device.wireguard_tunnel_ip
    : `${device.wireguard_tunnel_ip}/32`;

  const script = renderRouterScript({
    deviceId: device.id,
    deviceName: device.name,
    provisioningToken: device.provisioning_token,
    wireguardServerPubkey: device.wireguard_server_pubkey,
    wireguardServerEndpoint,
    wireguardClientPrivkey: device.wireguard_client_privkey,
    wireguardTunnelIp,
    radiusTunnelIp: "10.77.0.1",
    radiusSecret,
    mikrotikApiUsername: device.mikrotik_api_username,
    mikrotikApiPassword: device.mikrotik_api_password,
    captivePortalBaseUrl: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/captive-portal-builds`,
    functionsBaseUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
  });

  return new Response(script, {
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
});
