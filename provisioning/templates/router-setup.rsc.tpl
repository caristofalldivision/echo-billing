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
#   {{CAPTIVE_PORTAL_BASE_URL}}  where the built portal is hosted, e.g.
#                                https://captive.echoisp.click (default —
#                                see apps/captive-portal/README.md)
#   {{FUNCTIONS_BASE_URL}}       https://<project>.supabase.co/functions/v1
#   {{PROVISIONING_TOKEN}}       this device's heartbeat bearer token
# ============================================================

# --- 0a. WAN bring-up — every fetch below assumes ether1 can reach the
#         internet. RouterOS's factory-default config normally has a DHCP
#         client on ether1 doing this silently, but a router reset with
#         "no default configuration" strips that too. Guarded on "does
#         ether1 have any address at all" rather than "does a dhcp-client
#         object exist", so this correctly no-ops on factory defaults, a
#         static IP an admin already set, or a prior run of this same
#         script — it only acts when ether1 truly has nothing. -----------
:if ([:len [/ip address find interface=ether1]] = 0) do={ \
  /ip dhcp-client add interface=ether1 disabled=no add-default-route=yes use-peer-dns=yes }
:local wanWait 0
:while ($wanWait < 20 and [:len [/ip address find interface=ether1]] = 0) do={ :delay 1s; :set wanWait ($wanWait + 1) }

# --- 0b. Clock sync — RouterOS validates TLS certs on the HTTPS fetches
#        below, and a wrong clock is the #1 cause of those silently
#        failing on a router that's never synced time before. ------------
/system ntp client set enabled=yes
:if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }
:delay 3s

# --- 1. WireGuard tunnel back to Echo -----------------------------------
# The interface/address blocks below are update-aware, not just
# add-if-missing — deleting a device (a real admin-portal flow) and
# re-provisioning the SAME physical router under a DIFFERENT device row
# generates a new keypair + tunnel IP server-side; a plain "add if missing"
# guard would leave the router silently running its OLD private key/address
# forever (an interface by that name already exists), while radius-service
# has already dropped the old peer — the WireGuard handshake then never
# even starts. Re-running for the SAME device is unaffected (values already
# match, so these are no-ops); this only changes behavior when they've
# drifted.
/interface wireguard
:if ([:len [find name="echo-tunnel"]] = 0) do={ \
  add name=echo-tunnel listen-port=51820 private-key="{{WIREGUARD_CLIENT_PRIVKEY}}" \
} else={ \
  :if ([/interface wireguard get [find name="echo-tunnel"] private-key] != "{{WIREGUARD_CLIENT_PRIVKEY}}") do={ \
    /interface wireguard set [find name="echo-tunnel"] private-key="{{WIREGUARD_CLIENT_PRIVKEY}}" } }

/interface wireguard peers
:if ([:len [find comment="echo-server"]] = 0) do={ \
  add interface=echo-tunnel public-key="{{WIREGUARD_SERVER_PUBKEY}}" \
    endpoint-address=[:pick "{{WIREGUARD_SERVER_ENDPOINT}}" 0 [:find "{{WIREGUARD_SERVER_ENDPOINT}}" ":"]] \
    endpoint-port=[:pick "{{WIREGUARD_SERVER_ENDPOINT}}" ([:find "{{WIREGUARD_SERVER_ENDPOINT}}" ":"]+1) [:len "{{WIREGUARD_SERVER_ENDPOINT}}"]] \
    allowed-address=10.77.0.0/16 persistent-keepalive=25s comment=echo-server }

/ip address
:if ([:len [find interface=echo-tunnel]] = 0) do={ \
  add address={{WIREGUARD_TUNNEL_IP}} interface=echo-tunnel \
} else={ \
  :if ([/ip address get [find interface=echo-tunnel] address] != "{{WIREGUARD_TUNNEL_IP}}") do={ \
    /ip address set [find interface=echo-tunnel] address={{WIREGUARD_TUNNEL_IP}} } }

# A WireGuard peer's allowed-address only controls which packets the
# tunnel will carry — unlike Linux's wg-quick, RouterOS does NOT use it
# to populate the routing table. Without this route the router has no
# way to know 10.77.0.1 (radius-service) is reachable via echo-tunnel at
# all, and RADIUS requests fail immediately with "Network unreachable"
# instead of ever leaving the router.
/ip route
:if ([:len [find dst-address="10.77.0.0/16" gateway="echo-tunnel"]] = 0) do={ add dst-address=10.77.0.0/16 gateway=echo-tunnel }

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

# --- 2b. NAT masquerade for the WAN interface — without this, hotspot
#         clients authenticate fine (that part's handled by /ip hotspot
#         itself) but their traffic to the real internet has no address
#         translation and silently goes nowhere: DNS queries to 1.1.1.1/
#         8.8.8.8 never get a reply back, so it looks like "connects but no
#         internet" / "doesn't redirect to anything" from the client side.
#         /ip hotspot add does NOT set this up — it's a general router NAT
#         concern, not hotspot-specific, and nothing else in this script
#         added it either.
/ip firewall nat
:if ([:len [find chain=srcnat out-interface=ether1 action=masquerade]] = 0) do={ \
  add chain=srcnat out-interface=ether1 action=masquerade comment=echo-wan-nat }

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
  :if ([:len [find address="10.55.0.0/24"]] = 0) do={ add address=10.55.0.0/24 gateway=10.55.0.1 dns-server=10.55.0.1 } \
}

# --- 3b. Router as the hotspot's own DNS resolver — handing out an
#         external resolver (1.1.1.1/8.8.8.8) here used to mean every DNS
#         lookup from an unauthenticated client round-tripped off-box before
#         the hotspot could even see the HTTP request to intercept, which
#         was a large chunk of "takes forever to redirect to the login
#         page." Answering locally (with its own cache, falling back to
#         these same public resolvers) cuts that to a LAN round-trip for
#         every repeat lookup. allow-remote-requests=yes is what lets the
#         DHCP-assigned bridge address actually answer client queries at
#         all; it's off by default.
/ip dns
set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8 cache-size=2048KiB

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
# Found 2026-09: Pesapal's hosted checkout page (loaded via a plain
# top-level redirect while the customer is still unauthenticated) pulls in
# two render-BLOCKING <script> tags — h.online-metrix.net (device
# fingerprinting) and songbird.cardinalcommerce.com (3-D Secure) — neither
# behind *.pesapal.com. Without these walled-gardened, the browser stalls on
# each one for a full connection-timeout before continuing, which is most of
# what made checkout feel like it "takes way too long" and made customers
# close the page before the STK push even fired. www.googletagmanager.com is
# their analytics tag (async, lower stakes, included anyway since it's
# cheap); bare pesapal.com covers their footer/terms links that *.pesapal.com
# may not match depending on RouterOS's wildcard semantics.
/ip hotspot walled-garden
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "pesapal.com"; "cybqa.pesapal.com"; \
    "h.online-metrix.net"; "songbird.cardinalcommerce.com"; "www.googletagmanager.com"} do={ \
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 8. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="{{MIKROTIK_API_USERNAME}}"]] = 0) do={ \
  add name="{{MIKROTIK_API_USERNAME}}" password="{{MIKROTIK_API_PASSWORD}}" group=echo-api }

# --- 9. Captive portal files — fetched onto the router itself ----------
# dst-path is "flash/hotspot/..." (not bare "hotspot/...") because the
# hotspot profile's html-directory=hotspot (section 5) resolves to the real
# on-disk flash/hotspot/ — RouterOS auto-installs its own bundled default
# skin there the instant `/ip hotspot add` runs. A bare "hotspot/..."
# dst-path was found (RB760iGS, RouterOS 7.x) to land in a different,
# sibling top-level directory the hotspot server never reads from — files
# fetched with no errors, router silently kept serving MikroTik's own
# default login page instead of ours.
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/login.html" dst-path="flash/hotspot/login.html" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/redirect.html" dst-path="flash/hotspot/redirect.html" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.css" dst-path="flash/hotspot/assets/app.css" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/app.js" dst-path="flash/hotspot/assets/app.js" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/logo.svg" dst-path="flash/hotspot/assets/logo.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/doodle-waves.svg" dst-path="flash/hotspot/assets/doodle-waves.svg" mode=https
/tool fetch url="{{CAPTIVE_PORTAL_BASE_URL}}/assets/success.svg" dst-path="flash/hotspot/assets/success.svg" mode=https

# --- 10. Heartbeat — periodic check-in so Echo knows this device is alive
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \
  add name=echo-heartbeat interval=2m on-event=":local r [/tool fetch url=\"{{FUNCTIONS_BASE_URL}}/heartbeat\" http-method=post http-header-field=\"Authorization: Bearer {{PROVISIONING_TOKEN}}\" as-value output=none]" }

# Fire one heartbeat right now instead of waiting for the scheduler's first
# tick — this is what flips the device to "linked" in the admin portal, so
# doing it here means that happens within seconds of the script finishing.
/tool fetch url="{{FUNCTIONS_BASE_URL}}/heartbeat" http-method=post http-header-field="Authorization: Bearer {{PROVISIONING_TOKEN}}" as-value output=none

# --- 11. IP allowlist sync — periodic fetch+import of statically-allowed
#         IPs that bypass the hotspot login entirely. A deliberately
#         separate scheduler from echo-heartbeat above, not folded into
#         it — leaves that already-hardened block completely untouched.
/system scheduler
:if ([:len [find name="echo-ip-sync"]] = 0) do={ \
  add name=echo-ip-sync interval=5m on-event="/tool fetch url=\"{{FUNCTIONS_BASE_URL}}/ip-bindings-sync?token={{PROVISIONING_TOKEN}}\" dst-path=\"echo-ipsync.rsc\" mode=https; /import file-name=echo-ipsync.rsc" }

/tool fetch url="{{FUNCTIONS_BASE_URL}}/ip-bindings-sync?token={{PROVISIONING_TOKEN}}" dst-path="echo-ipsync.rsc" mode=https
/import file-name=echo-ipsync.rsc

:put "Echo provisioning complete for {{DEVICE_NAME}}. Hotspot bridge: $hsBridge"
