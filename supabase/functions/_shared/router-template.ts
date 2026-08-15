// Renders the one-time RouterOS provisioning script for a device. This is
// the canonical version used by supabase/functions/provisioning-script and
// supabase/functions/provisioning-fetch — `provisioning/templates/router-setup.rsc.tpl`
// is a human-readable reference copy for manual review; keep both in sync
// when you change this.
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
# Assumes ether1 is the internet uplink (WAN) — every other ethernet port
# and every wireless radio gets bridged into the hotspot LAN. If ether1
# isn't your WAN port on this hardware, stop and adjust section 2 first.
# Re-run is safe — sections are idempotent where practical.
# ============================================================

# --- 0. Clock sync — RouterOS validates TLS certs on the HTTPS fetches
#        below, and a wrong clock is the #1 cause of those silently
#        failing on a router that's never synced time before. ------------
/system ntp client set enabled=yes
:if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }
:delay 3s

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

# --- 2. LAN bridge — reuse one if it already exists (e.g. factory
#        default), otherwise create it and bridge every non-WAN port and
#        every wireless radio into it. This is the piece that was
#        entirely missing before: without it, hotspot clients get no DHCP
#        offer at all and self-assign a 169.254.x.x address. -------------
:local hsBridge ""
:local existingBridges [/interface bridge find]
:if ([:len $existingBridges] > 0) do={ \\
  :set hsBridge [/interface bridge get [:pick $existingBridges 0] name] \\
} else={ \\
  /interface bridge add name=bridge-hotspot; \\
  :set hsBridge "bridge-hotspot" \\
}

:foreach i in=[/interface ethernet find where name!="ether1"] do={ \\
  :local n [/interface ethernet get $i name]; \\
  :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } }

:if ([:len [/interface wireless find]] > 0) do={ \\
  /interface wireless security-profiles; \\
  :if ([:len [find name="echo-open"]] = 0) do={ add name=echo-open mode=none }; \\
  :foreach i in=[/interface wireless find] do={ \\
    :local n [/interface wireless get $i name]; \\
    :if ([/interface wireless get $i disabled]=true) do={ \\
      /interface wireless set $i ssid=("Echo-" . $n) security-profile=echo-open disabled=no mode=ap-bridge }; \\
    :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } } }

# --- 3. DHCP for the hotspot LAN — only if this bridge has no address
#        yet (i.e. we created it fresh). A pre-existing bridge is assumed
#        to already have working DHCP (true for factory-default config). -
:if ([:len [/ip address find interface=$hsBridge]] = 0) do={ \\
  /ip pool; \\
  :if ([:len [find name="echo-hotspot-pool"]] = 0) do={ add name=echo-hotspot-pool ranges=10.55.0.10-10.55.0.254 }; \\
  /ip address add address=10.55.0.1/24 interface=$hsBridge; \\
  /ip dhcp-server; \\
  :if ([:len [find interface=$hsBridge]] = 0) do={ add name=echo-hotspot-dhcp interface=$hsBridge address-pool=echo-hotspot-pool lease-time=1h disabled=no }; \\
  /ip dhcp-server network; \\
  :if ([:len [find address="10.55.0.0/24"]] = 0) do={ add address=10.55.0.0/24 gateway=10.55.0.1 dns-server=1.1.1.1,8.8.8.8 } \\
}

# --- 4. RADIUS client (hotspot + PPPoE auth/accounting via Echo) ------
/radius
:if ([:len [find comment="echo-radius"]] = 0) do={ \\
  add service=hotspot,ppp address=${p.radiusTunnelIp} secret="${p.radiusSecret}" \\
    timeout=3s comment=echo-radius }

/radius incoming
set accept=yes port=3799

# --- 5. Hotspot: RADIUS-backed profile, then the actual server ---------
/ip hotspot profile
:if ([:len [find name="echo-hotspot-profile"]] = 0) do={ \\
  add name=echo-hotspot-profile use-radius=yes radius-accounting=yes login-by=http-chap,http-pap html-directory=hotspot }

:local hsPool "echo-hotspot-pool"
:local existingDhcp [/ip dhcp-server find interface=$hsBridge]
:if ([:len $existingDhcp] > 0) do={ :set hsPool [/ip dhcp-server get [:pick $existingDhcp 0] address-pool] }

/ip hotspot
:if ([:len [find interface=$hsBridge]] = 0) do={ \\
  add interface=$hsBridge address-pool=$hsPool profile=echo-hotspot-profile disabled=no }

# --- 6. PPPoE: use RADIUS for auth + accounting -------------------------
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# --- 7. Walled garden — allow the payment/API domains before login -----
/ip hotspot walled-garden
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "cybqa.pesapal.com"} do={ \\
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 8. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="${p.mikrotikApiUsername}"]] = 0) do={ \\
  add name="${p.mikrotikApiUsername}" password="${p.mikrotikApiPassword}" group=echo-api }

# --- 9. Captive portal files — fetched onto the router itself ----------
${fetchLines}

# --- 10. Heartbeat — periodic check-in so Echo knows this device is alive
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \\
  add name=echo-heartbeat interval=5m on-event=":local r [/tool fetch url=\\"${p.functionsBaseUrl}/heartbeat\\" http-method=post http-header-field=\\"Authorization: Bearer ${p.provisioningToken}\\" as-value output=none]" }

:put "Echo provisioning complete for ${p.deviceName}. Hotspot bridge: $hsBridge"
`;
}

/**
 * The tiny bootstrap admins paste manually — fetches the real script (above)
 * as a file and imports it, instead of pasting the whole thing into a
 * terminal. RouterOS reads an imported file byte-for-byte, which sidesteps
 * the long-line paste corruption that WinBox's "New Terminal" widget is
 * prone to on scripts this size (the heartbeat scheduler line especially —
 * that's the one line responsible for a device ever showing "linked").
 */
export function renderBootstrapScript(functionsBaseUrl: string, provisioningToken: string): string {
  // NTP has to run here too, not just inside the fetched script — this
  // fetch is itself an HTTPS request, so if it's the clock breaking cert
  // validation, the fix needs to land before this line, not after it.
  return `/system ntp client set enabled=yes
:if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }
:delay 5s
/tool fetch url="${functionsBaseUrl}/provisioning-fetch?token=${provisioningToken}" dst-path="echo-setup.rsc" mode=https
/import file-name=echo-setup.rsc
`;
}
