// Admin-triggered: generates (or re-generates) the WireGuard identity for a
// mikrotik_devices row and returns the rendered one-time RouterOS script.
// Requires a Supabase auth JWT.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { renderRouterScript } from "../_shared/router-template.ts";
import nacl from "npm:tweetnacl@1";

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function randomToken(bytes = 16) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const { mikrotikDeviceId } = await req.json();
    if (!mikrotikDeviceId) return withCors({ error: "mikrotikDeviceId is required" }, { status: 400 });

    const supabase = supabaseAdmin();
    const org = await getOrgSettings();

    const { data: device, error } = await supabase
      .from("mikrotik_devices")
      .select("*")
      .eq("id", mikrotikDeviceId)
      .single();
    if (error || !device) return withCors({ error: "Device not found" }, { status: 404 });

    const keypair = nacl.box.keyPair();
    const mikrotikApiUsername = `echo-api-${randomToken(4).toLowerCase()}`;
    const mikrotikApiPassword = randomToken(18);

    const { count } = await supabase
      .from("mikrotik_devices")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .not("wireguard_tunnel_ip", "is", null);
    const tunnelHostOctet = (count ?? 0) + 2; // .1 is reserved for radius-service
    const wireguardTunnelIp = `10.77.0.${tunnelHostOctet}/32`;

    const updated = {
      wireguard_client_pubkey: b64(keypair.publicKey),
      wireguard_client_privkey: b64(keypair.secretKey),
      wireguard_tunnel_ip: wireguardTunnelIp,
      mikrotik_api_username: mikrotikApiUsername,
      mikrotik_api_password: mikrotikApiPassword,
      wireguard_server_pubkey: Deno.env.get("WIREGUARD_SERVER_PUBKEY") ?? "",
    };
    await supabase.from("mikrotik_devices").update(updated).eq("id", device.id);

    const script = renderRouterScript({
      deviceId: device.id,
      deviceName: device.name,
      provisioningToken: device.provisioning_token,
      wireguardServerPubkey: updated.wireguard_server_pubkey,
      wireguardServerEndpoint: Deno.env.get("WIREGUARD_SERVER_ENDPOINT") ?? "radius.echo.example:51820",
      wireguardClientPrivkey: updated.wireguard_client_privkey,
      wireguardTunnelIp: updated.wireguard_tunnel_ip,
      radiusTunnelIp: "10.77.0.1",
      radiusSecret: Deno.env.get("RADIUS_SHARED_SECRET") ?? "change-me",
      mikrotikApiUsername,
      mikrotikApiPassword,
      captivePortalBaseUrl: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/captive-portal-builds`,
      functionsBaseUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
    });

    return withCors({ script });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
