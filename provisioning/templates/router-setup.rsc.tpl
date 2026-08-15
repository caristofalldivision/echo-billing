# ============================================================
# Echo — RouterOS provisioning script (reference copy)
#
# This is a human-readable copy of what
# supabase/functions/_shared/router-template.ts renders per-device — that
# TypeScript version is the one actually served to admins from the
# "Get setup script" button in /devices. Keep this file in sync when you
# change the generator; it exists so the script can be reviewed/audited
# without deploying an edge function.
#
# Assumes ether1 is the internet uplink (WAN) — every other ethernet port
# and every wireless radio gets bridged into the hotspot LAN. If ether1
# isn't your WAN port on this hardware, adjust section 2 before running.
#
# In practice, don't paste this whole file into a terminal — a script this
# long is prone to corruption in WinBox's "New Terminal" widget on long
# lines (the heartbeat scheduler line especially). Instead paste the two
# lines shown by "Get setup script" in the admin portal, which fetch this
# exact rendered script as a file and /import it. See renderBootstrapScript
# in router-template.ts and supabase/functions/provisioning-fetch.
#
# Placeholders (replaced by the generator):
#   {{DEVICE_NAME}}              human-readable device name
#   {{WIREGUARD_CLIENT_PRIVKEY}} generated once per device, never reused
#   {{WIREGUARD_SERVER_PUBKEY}}  radius-service's WireGuard public key
#   {{WIREGUARD_SERVER_ENDPOINT}} host:port routers dial, e.g. radius.example.com:51820
#   {{WIREGUARD_TUNNEL_IP}}      this device's address on the tunnel, e.g. 10.77.0.5/32
#   {{RADIUS_TUNNEL_IP}}         radius-service's address on the tunnel, e.g. 10.77.0.1
#   {{RADIUS_SECRET}}            shared RADIUS secret
#   {{MIKROTIK_API_USERNAME}}    generated per-device API user
#   {{MIKROTIK_API_PASSWORD}}    generated per-device API password
#   {{CAPTIVE_PORTAL_BASE_URL}}  public Supabase Storage URL for the built portal
#   {{FUNCTIONS_BASE_URL}}       https://<project>.supabase.co/functions/v1
#   {{PROVISIONING_TOKEN}}       this device's heartbeat bearer token
# ============================================================

# --- 0. Clock sync — RouterOS validates TLS certs on the HTTPS fetches
#        below, and a wrong clock is the #1 cause of those silently
#        failing on a router that's never synced time before. ------------
/system ntp client set enabled=yes
:if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }
:delay 3s

# --- 1. WireGuard tunnel back to Echo ---------------------------------
/interface wireguard
:if ([:len [find name="echo-tunnel"]] = 0) do={ add name=echo-tunnel listen-port=51820 private-key="{{WIREGUARD_CLIENT_PRIVKEY}}" }

/interface wireguard peers
:if ([:len [find comment="echo-server"]] = 0) do={ \
  add interface=echo-tunnel public-key="{{WIREGUARD_SERVER_PUBKEY}}" \
    endpoint-address=[:pick "{{WIREGUARD_SERVER_ENDPOINT}}" 0 [:find "{{WIREGUARD_SERVER_ENDPOINT}}" ":"]] \
    endpoint-port=[:pick "{{WIREGUARD_SERVER_ENDPOINT}}" ([:find "{{WIREGUARD_SERVER_ENDPOINT}}" ":"]+1) [:len "{{WIREGUARD_SERVER_ENDPOINT}}"]] \
    allowed-address=10.77.0.0/16 persistent-keepalive=25s comment=echo-server }

/ip address
:if ([:len [find interface=echo-tunnel]] = 0) do={ add address={{WIREGUARD_TUNNEL_IP}} interface=echo-tunnel }

# --- 2. LAN bridge — reuse one if it already exists (e.g. factory
#        default), otherwise create it and bridge every non-WAN port and
#        every wireless radio into it. This is the piece that was
#        entirely missing before: without it, hotspot clients get no DHCP
#        offer at all and self-assign a 169.254.x.x address. -------------
:local hsBridge ""
:local existingBridges [/interface bridge find]
:if ([:len $existingBridges] > 0) do={ \
  :set hsBridge [/interface bridge get [:pick $existingBridges 0] name] \
} else={ \
  /interface bridge add name=bridge-hotspot; \
  :set hsBridge "bridge-hotspot" \
}

:foreach i in=[/interface ethernet find where name!="ether1"] do={ \
  :local n [/interface ethernet get $i name]; \
  :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } }

:if ([:len [/interface wireless find]] > 0) do={ \
  /interface wireless security-profiles; \
  :if ([:len [find name="echo-open"]] = 0) do={ add name=echo-open mode=none }; \
  :foreach i in=[/interface wireless find] do={ \
    :local n [/interface wireless get $i name]; \
    :if ([/interface wireless get $i disabled]=true) do={ \
      /interface wireless set $i ssid=("Echo-" . $n) security-profile=echo-open disabled=no mode=ap-bridge }; \
    :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } } }

# --- 3. DHCP for the hotspot LAN — only if this bridge has no address
#        yet (i.e. we created it fresh). A pre-existing bridge is assumed
#        to already have working DHCP (true for factory-default config). -
:if ([:len [/ip address find interface=$hsBridge]] = 0) do={ \
  /ip pool; \
  :if ([:len [find name="echo-hotspot-pool"]] = 0) do={ add name=echo-hotspot-pool ranges=10.55.0.10-10.55.0.254 }; \
  /ip address add address=10.55.0.1/24 interface=$hsBridge; \
  /ip dhcp-server; \
  :if ([:len [find interface=$hsBridge]] = 0) do={ add name=echo-hotspot-dhcp interface=$hsBridge address-pool=echo-hotspot-pool lease-time=1h disabled=no }; \
  /ip dhcp-server network; \
  :if ([:len [find address="10.55.0.0/24"]] = 0) do={ add address=10.55.0.0/24 gateway=10.55.0.1 dns-server=1.1.1.1,8.8.8.8 } \
}

# --- 4. RADIUS client (hotspot + PPPoE auth/accounting via Echo) ------
/radius
:if ([:len [find comment="echo-radius"]] = 0) do={ \
  add service=hotspot,ppp address={{RADIUS_TUNNEL_IP}} secret="{{RADIUS_SECRET}}" \
    timeout=3s comment=echo-radius }

/radius incoming
set accept=yes port=3799

# --- 5. Hotspot: RADIUS-backed profile, then the actual server ---------
/ip hotspot profile
:if ([:len [find name="echo-hotspot-profile"]] = 0) do={ \
  add name=echo-hotspot-profile use-radius=yes radius-accounting=yes login-by=http-chap,http-pap html-directory=hotspot }

:local hsPool "echo-hotspot-pool"
:local existingDhcp [/ip dhcp-server find interface=$hsBridge]
:if ([:len $existingDhcp] > 0) do={ :set hsPool [/ip dhcp-server get [:pick $existingDhcp 0] address-pool] }

/ip hotspot
:if ([:len [find interface=$hsBridge]] = 0) do={ \
  add interface=$hsBridge address-pool=$hsPool profile=echo-hotspot-profile disabled=no }

# --- 6. PPPoE: use RADIUS for auth + accounting -------------------------
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# --- 7. Walled garden — allow the payment/API domains before login -----
/ip hotspot walled-garden
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "cybqa.pesapal.com"} do={ \
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 8. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="{{MIKROTIK_API_USERNAME}}"]] = 0) do={ \
  add name="{{MIKROTIK_API_USERNAME}}" password="{{MIKROTIK_API_PASSWORD}}" group=echo-api }

# --- 9. Captive portal files — fetched onto the router itself ----------
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/login.html" dst-path="hotspot/login.html" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.css" dst-path="hotspot/assets/app.css" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.js" dst-path="hotspot/assets/app.js" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/logo.svg" dst-path="hotspot/assets/logo.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/doodle-waves.svg" dst-path="hotspot/assets/doodle-waves.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/success.svg" dst-path="hotspot/assets/success.svg" mode=https

# --- 10. Heartbeat — periodic check-in so Echo knows this device is alive
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \
  add name=echo-heartbeat interval=5m on-event=":local r [/tool fetch url=\"{{FUNCTIONS_BASE_URL}}/heartbeat\" http-method=post http-header-field=\"Authorization: Bearer {{PROVISIONING_TOKEN}}\" as-value output=none]" }

:put "Echo provisioning complete for {{DEVICE_NAME}}. Hotspot bridge: $hsBridge"
