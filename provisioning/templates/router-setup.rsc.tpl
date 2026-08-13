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

# --- 2. RADIUS client (hotspot + PPPoE auth/accounting via Echo) ------
/radius
:if ([:len [find comment="echo-radius"]] = 0) do={ \
  add service=hotspot,ppp address={{RADIUS_TUNNEL_IP}} secret="{{RADIUS_SECRET}}" \
    timeout=3s comment=echo-radius }

/radius incoming
set accept=yes port=3799

# --- 3. Hotspot: use RADIUS for auth + accounting ----------------------
/ip hotspot profile
:if ([:len [find name="echo-hotspot-profile"]] = 0) do={ \
  add name=echo-hotspot-profile use-radius=yes radius-accounting=yes login-by=http-chap,http-pap html-directory=hotspot }

# --- 4. PPPoE: use RADIUS for auth + accounting -------------------------
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# --- 5. Walled garden — allow the payment/API domains before login -----
/ip hotspot walled-garden
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "cybqa.pesapal.com"} do={ \
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 6. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="{{MIKROTIK_API_USERNAME}}"]] = 0) do={ \
  add name="{{MIKROTIK_API_USERNAME}}" password="{{MIKROTIK_API_PASSWORD}}" group=echo-api }

# --- 7. Captive portal files — fetched onto the router itself ----------
# One /tool fetch per file (see CAPTIVE_PORTAL_FILES in router-template.ts) —
# RouterOS has no reliable unzip/archive support to rely on here.
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/login.html" dst-path="hotspot/login.html" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.css" dst-path="hotspot/assets/app.css" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.js" dst-path="hotspot/assets/app.js" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/logo.svg" dst-path="hotspot/assets/logo.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/doodle-waves.svg" dst-path="hotspot/assets/doodle-waves.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/success.svg" dst-path="hotspot/assets/success.svg" mode=https

# --- 8. Heartbeat — periodic check-in so Echo knows this device is alive
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \
  add name=echo-heartbeat interval=5m on-event=":local r [/tool fetch url=\"{{FUNCTIONS_BASE_URL}}/heartbeat\" http-method=post http-header-field=\"Authorization: Bearer {{PROVISIONING_TOKEN}}\" as-value output=none]" }

:put "Echo provisioning complete for {{DEVICE_NAME}}."
