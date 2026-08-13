// Renders the one-time RouterOS provisioning script for a device. This is
// the canonical version used by supabase/functions/provisioning-script —
// `provisioning/templates/router-setup.rsc.tpl` is a human-readable reference
// copy for manual review; keep both in sync when you change this.
//
// Known limitation: RouterOS has no unzip/JSON parsing worth relying on in a
// portable script, so the captive portal bundle is fetched file-by-file
// against a fixed manifest (see CAPTIVE_PORTAL_FILES) rather than as an
// archive. Keep apps/captive-portal's build output filenames in sync with
// this list.

// `login.html` is not an arbitrary choice — RouterOS's hotspot server looks
// for that exact filename in html-directory when it serves the captive
// portal to an unauthenticated client, and only inside that request does it
// substitute $(link-login-only)/$(link-orig)/etc. template variables.
export const CAPTIVE_PORTAL_FILES = [
  "login.html",
  "assets/app.css",
  "assets/app.js",
  "assets/logo.svg",
  "assets/doodle-waves.svg",
  "assets/success.svg",
];

export interface RouterScriptParams {
  deviceId: string;
  deviceName: string;
  provisioningToken: string;
  wireguardServerPubkey: string;
  wireguardServerEndpoint: string; // host:port
  wireguardClientPrivkey: string;
  wireguardTunnelIp: string; // e.g. 10.77.0.5/32
  radiusTunnelIp: string; // radius-service's address on the WG tunnel, e.g. 10.77.0.1
  radiusSecret: string;
  mikrotikApiUsername: string;
  mikrotikApiPassword: string;
  captivePortalBaseUrl: string; // public Supabase Storage URL for this org's build
  functionsBaseUrl: string; // https://<project>.supabase.co/functions/v1
}

export function renderRouterScript(p: RouterScriptParams): string {
  const fetchLines = CAPTIVE_PORTAL_FILES.map(
    (f) =>
      `/tool fetch url="${p.captivePortalBaseUrl}/${f}" dst-path="hotspot/${f}" mode=https`,
  ).join("\n");

  return `# ============================================================
# Echo — auto-generated provisioning script for "${p.deviceName}"
# Device id: ${p.deviceId}
# Paste this into a New Terminal on the router (or import as .rsc via WinBox)
# and run it once. Re-run is safe — sections are idempotent where practical.
# ============================================================

# --- 1. WireGuard tunnel back to Echo ---------------------------------
/interface wireguard
:if ([:len [find name="echo-tunnel"]] = 0) do={ add name=echo-tunnel listen-port=51820 private-key="${p.wireguardClientPrivkey}" }

/interface wireguard peers
:if ([:len [find comment="echo-server"]] = 0) do={ \\
  add interface=echo-tunnel public-key="${p.wireguardServerPubkey}" \\
    endpoint-address=[:pick "${p.wireguardServerEndpoint}" 0 [:find "${p.wireguardServerEndpoint}" ":"]] \\
    endpoint-port=[:pick "${p.wireguardServerEndpoint}" ([:find "${p.wireguardServerEndpoint}" ":"]+1) [:len "${p.wireguardServerEndpoint}"]] \\
    allowed-address=10.77.0.0/16 persistent-keepalive=25s comment=echo-server }

/ip address
:if ([:len [find interface=echo-tunnel]] = 0) do={ add address=${p.wireguardTunnelIp} interface=echo-tunnel }

# --- 2. RADIUS client (hotspot + PPPoE auth/accounting via Echo) ------
/radius
:if ([:len [find comment="echo-radius"]] = 0) do={ \\
  add service=hotspot,ppp address=${p.radiusTunnelIp} secret="${p.radiusSecret}" \\
    timeout=3s comment=echo-radius }

/radius incoming
set accept=yes port=3799

# --- 3. Hotspot: use RADIUS for auth + accounting ----------------------
/ip hotspot profile
:if ([:len [find name="echo-hotspot-profile"]] = 0) do={ \\
  add name=echo-hotspot-profile use-radius=yes radius-accounting=yes login-by=http-chap,http-pap html-directory=hotspot }

# --- 4. PPPoE: use RADIUS for auth + accounting -------------------------
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# --- 5. Walled garden — allow the payment/API domains before login -----
/ip hotspot walled-garden
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "cybqa.pesapal.com"} do={ \\
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 6. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="${p.mikrotikApiUsername}"]] = 0) do={ \\
  add name="${p.mikrotikApiUsername}" password="${p.mikrotikApiPassword}" group=echo-api }

# --- 7. Captive portal files — fetched onto the router itself ----------
${fetchLines}

# --- 8. Heartbeat — periodic check-in so Echo knows this device is alive
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \\
  add name=echo-heartbeat interval=5m on-event=":local r [/tool fetch url=\\"${p.functionsBaseUrl}/heartbeat\\" http-method=post http-header-field=\\"Authorization: Bearer ${p.provisioningToken}\\" as-value output=none]" }

:put "Echo provisioning complete for ${p.deviceName}."
`;
}
