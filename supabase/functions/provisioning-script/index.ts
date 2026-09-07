// Admin-triggered: generates (or re-generates) the WireGuard identity for a
// mikrotik_devices row and returns the rendered one-time RouterOS script —
// which embeds the WireGuard private key and MikroTik API password in
// plaintext. Requires a Supabase auth JWT belonging to an actual
// admin_users member of this org: verify_jwt=true at the gateway only
// proves the caller has *a* Supabase account, not that they're one of ours
// (see the long comment in voucher-generate/index.ts). This was previously
// the most severe of that whole class of gap — no auth check AND no org
// scoping on the device lookup meant anyone with any Supabase account could
// pull another org's router credentials by guessing/enumerating a
// mikrotikDeviceId.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin, getOrgSettings } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";
import { renderBootstrapScript, renderRouterScript } from "../_shared/router-template.ts";
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
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });

    const { mikrotikDeviceId, confirmRegenerate } = await req.json();
    if (!mikrotikDeviceId) return withCors({ error: "mikrotikDeviceId is required" }, { status: 400 });

    // These come from radius-service's own deployment (see radius-service/README.md
    // and CLAUDE.md Phase 2) — without them the script would connect to nothing.
    // Fail loudly instead of baking in placeholder values a router can never
    // actually reach, which would silently produce an unusable script.
    const wireguardServerPubkey = Deno.env.get("WIREGUARD_SERVER_PUBKEY");
    const wireguardServerEndpoint = Deno.env.get("WIREGUARD_SERVER_ENDPOINT");
    const radiusSecret = Deno.env.get("RADIUS_SHARED_SECRET");
    const missing = [
      !wireguardServerPubkey && "WIREGUARD_SERVER_PUBKEY",
      !wireguardServerEndpoint && "WIREGUARD_SERVER_ENDPOINT",
      !radiusSecret && "RADIUS_SHARED_SECRET",
    ].filter(Boolean);
    if (missing.length > 0) {
      return withCors(
        {
          error: `radius-service isn't deployed yet — missing function secret(s): ${missing.join(", ")}. Deploy radius-service (see CLAUDE.md Phase 2) and set these with "supabase secrets set" before linking a router.`,
        },
        { status: 500 },
      );
    }

    const supabase = supabaseAdmin();
    const org = await getOrgSettings(caller.org_id);

    const { data: device, error } = await supabase
      .from("mikrotik_devices")
      .select("*")
      .eq("id", mikrotikDeviceId)
      .eq("org_id", caller.org_id)
      .single();
    if (error || !device) return withCors({ error: "Device not found" }, { status: 404 });

    // Regenerating credentials for an already-linked router disconnects it —
    // require the caller to explicitly confirm that instead of doing it on
    // every "show me the script again" click.
    if (device.status === "linked" && !confirmRegenerate) {
      return withCors(
        {
          error: "already_linked",
          message:
            "This router is already linked. Regenerating its script issues new WireGuard credentials and will disconnect it until the new script is run.",
        },
        { status: 409 },
      );
    }

    const keypair = nacl.box.keyPair();
    const mikrotikApiUsername = `echo-api-${randomToken(4).toLowerCase()}`;
    const mikrotikApiPassword = randomToken(18);

    const { data: wireguardTunnelIp, error: ipError } = await supabase.rpc("next_wireguard_tunnel_ip", {
      p_org_id: org.id,
    });
    if (ipError) throw ipError;

    const updated = {
      wireguard_client_pubkey: b64(keypair.publicKey),
      wireguard_client_privkey: b64(keypair.secretKey),
      wireguard_tunnel_ip: wireguardTunnelIp,
      mikrotik_api_username: mikrotikApiUsername,
      mikrotik_api_password: mikrotikApiPassword,
      wireguard_server_pubkey: wireguardServerPubkey,
      status: "pending",
    };
    await supabase.from("mikrotik_devices").update(updated).eq("id", device.id);

    const functionsBaseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

    const script = renderRouterScript({
      deviceId: device.id,
      deviceName: device.name,
      provisioningToken: device.provisioning_token,
      wireguardServerPubkey: updated.wireguard_server_pubkey!,
      wireguardServerEndpoint: wireguardServerEndpoint!,
      wireguardClientPrivkey: updated.wireguard_client_privkey,
      wireguardTunnelIp: updated.wireguard_tunnel_ip as string,
      radiusTunnelIp: "10.77.0.1",
      radiusSecret: radiusSecret!,
      mikrotikApiUsername,
      mikrotikApiPassword,
      captivePortalBaseUrl: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/captive-portal-builds`,
      functionsBaseUrl,
    });

    const bootstrap = renderBootstrapScript(functionsBaseUrl, device.provisioning_token);

    return withCors({ script, bootstrap });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
