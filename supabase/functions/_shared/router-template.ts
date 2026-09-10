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
  // MikroTik's hotspot serves login.html directly for the /login route,
  // but relies on redirect.html to capture an arbitrary unauthenticated
  // request (e.g. a client just browsing to any site) and forward it to
  // /login with the original destination preserved. Without this file,
  // hotspot returns a bare 404 for anything except the literal /login
  // path — the login page itself works, nothing ever gets sent to it.
  "redirect.html",
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
  // dst-path is deliberately "flash/hotspot/..." and not the bare "hotspot/...".
  // The hotspot profile's html-directory=hotspot (section 5 below) resolves to
  // the real on-disk flash/hotspot/ — that's where RouterOS auto-installs its
  // own bundled default skin the instant `/ip hotspot add` runs. A bare
  // "hotspot/..." dst-path was found (on a RB760iGS, RouterOS 7.x) to land in
  // a different, sibling top-level directory that the hotspot server never
  // reads from — files fetched fine, router silently kept serving MikroTik's
  // own default login page. Explicit flash/ prefix keeps both sides pointed
  // at the same physical location regardless of board/RouterOS quirks.
  // Each fetch is individually wrapped in :do/on-error. A bare `/tool fetch`
  // that fails (host down, 404, TLS/cert problem — all seen in practice while
  // moving the portal between Supabase Storage and a custom domain) raises an
  // error that aborts the ENTIRE /import on the spot, so one missing asset
  // silently took down everything after section 9 too: the heartbeat
  // scheduler (device never shows "linked"), the IP-sync scheduler, and the
  // self-check that would have reported the problem. Failing per-file instead
  // means a broken asset URL degrades the captive portal's appearance rather
  // than the router's entire configuration, and the self-check at the end
  // still gets to run and say exactly what's missing.
  const fetchLines = CAPTIVE_PORTAL_FILES.map(
    (f) =>
      `:do { /tool fetch url="${p.captivePortalBaseUrl}/${f}" dst-path="flash/hotspot/${f}" mode=https } on-error={ :put "[Echo] WARN: could not fetch ${f} from ${p.captivePortalBaseUrl}" }`,
  ).join("\n");

  return `# ============================================================
# Echo — auto-generated provisioning script for "${p.deviceName}"
# Device id: ${p.deviceId}
# Assumes ether1 is the internet uplink (WAN) — every other ethernet port
# and every wireless radio gets bridged into the hotspot LAN. If ether1
# isn't your WAN port on this hardware, stop and adjust section 2 first.
# Re-run is safe — sections are idempotent where practical.
# ============================================================

# --- 0a. WAN bring-up — every fetch below (captive portal files,
#         heartbeat, this script's own delivery via renderBootstrapScript)
#         assumes ether1 can reach the internet. RouterOS's factory-default
#         config normally has a DHCP client on ether1 doing this silently,
#         but a router reset with "no default configuration" strips that
#         too — found 2026-09-10 when a from-scratch reset router had no
#         WAN at all and every HTTPS fetch failed immediately. Guarded on
#         "does ether1 have any address at all" rather than "does a
#         dhcp-client object exist", so this correctly no-ops on factory
#         defaults, a static IP an admin already set, or a prior run of
#         this same script — it only acts when ether1 truly has nothing. --
:if ([:len [/ip address find interface=ether1]] = 0) do={ \\
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
# add-if-missing — found 2026-09-10 the hard way: deleting a device (now a
# real admin-portal flow) and re-provisioning the *same physical router*
# under a *different* device row generates a brand-new keypair + tunnel IP
# server-side, but a plain "if no interface named echo-tunnel exists, add
# one" guard left the router silently running its OLD private key and OLD
# tunnel address forever, since an interface by that name already existed
# from the previous device. radius-service correctly drops the old peer
# (see wireguard.js's syncPeers() cleanup) the moment that old device row
# is gone, so the router ends up presenting a key the server no longer
# recognizes at all — the WireGuard handshake never even starts (confirmed
# live: 'wg show wg0 latest-handshakes' read 0 for the new peer, endpoint
# "(none)"), so nothing past this point — RADIUS, heartbeat, everything —
# can ever reach Echo, despite payments/vouchers working fine (those don't
# need this tunnel). Re-running this script for the SAME device is
# unaffected (the key/address already match, so these are no-ops); this
# only changes behavior when they've drifted.
/interface wireguard
:if ([:len [find name="echo-tunnel"]] = 0) do={ \\
  add name=echo-tunnel listen-port=51820 private-key="${p.wireguardClientPrivkey}" \\
} else={ \\
  :if ([/interface wireguard get [find name="echo-tunnel"] private-key] != "${p.wireguardClientPrivkey}") do={ \\
    /interface wireguard set [find name="echo-tunnel"] private-key="${p.wireguardClientPrivkey}" } }

/interface wireguard peers
:if ([:len [find comment="echo-server"]] = 0) do={ \\
  add interface=echo-tunnel public-key="${p.wireguardServerPubkey}" \\
    endpoint-address=[:pick "${p.wireguardServerEndpoint}" 0 [:find "${p.wireguardServerEndpoint}" ":"]] \\
    endpoint-port=[:pick "${p.wireguardServerEndpoint}" ([:find "${p.wireguardServerEndpoint}" ":"]+1) [:len "${p.wireguardServerEndpoint}"]] \\
    allowed-address=10.77.0.0/16 persistent-keepalive=25s comment=echo-server }

/ip address
:if ([:len [find interface=echo-tunnel]] = 0) do={ \\
  add address=${p.wireguardTunnelIp} interface=echo-tunnel \\
} else={ \\
  :if ([/ip address get [find interface=echo-tunnel] address] != "${p.wireguardTunnelIp}") do={ \\
    /ip address set [find interface=echo-tunnel] address=${p.wireguardTunnelIp} } }

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
:if ([:len $existingBridges] > 0) do={ \\
  :set hsBridge [/interface bridge get [:pick $existingBridges 0] name] \\
} else={ \\
  /interface bridge add name=bridge-hotspot; \\
  :set hsBridge "bridge-hotspot" \\
}

:foreach i in=[/interface ethernet find where name!="ether1"] do={ \\
  :local n [/interface ethernet get $i name]; \\
  :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } }

# The whole wireless block is wrapped in :do/on-error because
# "/interface wireless" is NOT a menu that exists on every board — it comes
# from the separate wireless package, absent on wired-only hardware like
# the RB760iGS/hEX S this was first deployed on. Referencing a nonexistent
# menu is a PARSE-TIME failure in RouterOS, not a runtime no-op: it aborts
# the ENTIRE /import immediately, so on a wired-only router every section
# after this one — the WAN masquerade rule (2b), DHCP (3), DNS (3b),
# RADIUS (4), hotspot (5), captive portal files (9), heartbeat (10) —
# silently never ran. That presented as the maddening "hotspot logs the
# customer in but they have no internet": the hotspot/RADIUS config the
# router *did* have was leftover from an earlier, differently-shaped run,
# while the masquerade rule this script is solely responsible for adding
# had genuinely never been created even once. Found 2026-09-10 after the
# admin's own '/ip firewall nat print' showed only RouterOS's own dynamic
# hotspot rules and no srcnat masquerade at all.
:do { \\
  :if ([:len [/interface wireless find]] > 0) do={ \\
    /interface wireless security-profiles; \\
    :if ([:len [find name="echo-open"]] = 0) do={ add name=echo-open mode=none }; \\
    :foreach i in=[/interface wireless find] do={ \\
      :local n [/interface wireless get $i name]; \\
      :if ([/interface wireless get $i disabled]=true) do={ \\
        /interface wireless set $i ssid=("Echo-" . $n) security-profile=echo-open disabled=no mode=ap-bridge }; \\
      :if ([:len [/interface bridge port find interface=$n]] = 0) do={ /interface bridge port add bridge=$hsBridge interface=$n } } } \\
} on-error={ :put "[Echo] no wireless package on this board (normal on hEX/RB760iGS) - skipping radios, wired ports still bridged" }

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
:if ([:len [find chain=srcnat out-interface=ether1 action=masquerade]] = 0) do={ \\
  add chain=srcnat out-interface=ether1 action=masquerade comment=echo-wan-nat }
:put "[Echo] 2b/  WAN masquerade OK"

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
  :if ([:len [find address="10.55.0.0/24"]] = 0) do={ add address=10.55.0.0/24 gateway=10.55.0.1 dns-server=10.55.0.1 } \\
}

# --- 3b. Router as the hotspot's own DNS resolver — handing out an
#         external resolver (1.1.1.1/8.8.8.8) here used to mean every DNS
#         lookup from an unauthenticated client round-tripped off-box before
#         the hotspot could even see the HTTP request to intercept, which
#         was a large chunk of "takes forever to redirect to the login
#         page." Answering locally (with its own cache, falling back to
#         these same public resolvers) cuts that to a LAN round-trip for
#         every repeat lookup — every client asking for the same captive-
#         check/ad/telemetry domain after the first hits cache instead of
#         the internet. allow-remote-requests=yes is what lets the DHCP-
#         assigned bridge address actually answer client queries at all;
#         it's off by default.
/ip dns
set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8 cache-size=2048KiB

# --- 4. RADIUS client (hotspot + PPPoE auth/accounting via Echo) ------
# Authoritative (set, not just add-if-missing) for the same reason as the
# WireGuard block above: provisioning a NEW device onto a router that still
# carries a previous device's Echo config must overwrite it, not silently
# inherit it.
/radius
:if ([:len [find comment="echo-radius"]] = 0) do={ \\
  add service=hotspot,ppp address=${p.radiusTunnelIp} secret="${p.radiusSecret}" \\
    timeout=3s comment=echo-radius \\
} else={ \\
  set [find comment="echo-radius"] service=hotspot,ppp address=${p.radiusTunnelIp} \\
    secret="${p.radiusSecret}" timeout=3s }

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
:foreach domain in={"*.supabase.co"; "*.pesapal.com"; "pesapal.com"; "cybqa.pesapal.com"; \\
    "h.online-metrix.net"; "songbird.cardinalcommerce.com"; "www.googletagmanager.com"} do={ \\
  :if ([:len [find dst-host=$domain]] = 0) do={ add dst-host=$domain action=allow } }

# --- 8. API user for Echo's provisioning/remote-management calls -------
/user group
:if ([:len [find name="echo-api"]] = 0) do={ add name=echo-api policy=api,read,write,rest-api }
/user
:if ([:len [find name="${p.mikrotikApiUsername}"]] = 0) do={ \\
  add name="${p.mikrotikApiUsername}" password="${p.mikrotikApiPassword}" group=echo-api \\
} else={ \\
  set [find name="${p.mikrotikApiUsername}"] password="${p.mikrotikApiPassword}" group=echo-api }
# Retire API users from previous provisioning runs. Each run mints a fresh
# echo-api-* username, so without this every re-provision left another
# working admin-capable credential on the router forever — including ones
# belonging to device rows that have since been deleted from Echo, whose
# passwords are still sitting in an old script an admin may have pasted
# into a chat or a text file.
:foreach u in=[/user find group="echo-api"] do={ \\
  :if ([/user get $u name] != "${p.mikrotikApiUsername}") do={ /user remove $u } }

# --- 9. Captive portal files — fetched onto the router itself ----------
${fetchLines}

# --- 10. Heartbeat — periodic check-in so Echo knows this device is alive
# on-event is SET when the scheduler already exists, not left alone. It
# embeds this device's provisioning_token, so a router being provisioned as
# a NEW device while still carrying a previous device's scheduler would
# otherwise keep POSTing the old (possibly deleted) device's token forever
# — the new device row would flip to "linked" once from the immediate fetch
# below, then never heartbeat again and silently go stale. CLAUDE.md's
# guidance to prefer a new, separately-named scheduler over editing an
# existing one's on-event is about *introducing new scheduled behavior*
# without disturbing already-provisioned routers; this is the opposite
# case — a deliberate re-provision, where inheriting the old token is
# exactly the bug.
:local hbEvent ":local r [/tool fetch url=\\"${p.functionsBaseUrl}/heartbeat\\" http-method=post http-header-field=\\"Authorization: Bearer ${p.provisioningToken}\\" as-value output=none]"
/system scheduler
:if ([:len [find name="echo-heartbeat"]] = 0) do={ \\
  add name=echo-heartbeat interval=2m on-event=$hbEvent \\
} else={ \\
  set [find name="echo-heartbeat"] interval=2m on-event=$hbEvent }

# Fire one heartbeat right now instead of waiting for the scheduler's first
# tick — this is what actually flips the device to "linked" in the admin
# portal, so doing it here means that happens within seconds of the script
# finishing, not on whatever RouterOS's own scheduler start-time behavior is.
/tool fetch url="${p.functionsBaseUrl}/heartbeat" http-method=post http-header-field="Authorization: Bearer ${p.provisioningToken}" as-value output=none

# --- 11. IP allowlist sync — periodic fetch+import of statically-allowed
#         IPs that bypass the hotspot login entirely (an office device,
#         printer, etc.) A deliberately separate scheduler from
#         echo-heartbeat above, not folded into it — leaves that
#         already-hardened block completely untouched regardless of
#         anything that happens here.
# SET when it already exists, for the same stale-provisioning_token reason
# spelled out on echo-heartbeat above.
:local ipSyncEvent "/tool fetch url=\\"${p.functionsBaseUrl}/ip-bindings-sync?token=${p.provisioningToken}\\" dst-path=\\"echo-ipsync.rsc\\" mode=https; /import file-name=echo-ipsync.rsc"
/system scheduler
:if ([:len [find name="echo-ip-sync"]] = 0) do={ \\
  add name=echo-ip-sync interval=5m on-event=$ipSyncEvent \\
} else={ \\
  set [find name="echo-ip-sync"] interval=5m on-event=$ipSyncEvent }

# Apply whatever's already on the allowlist right now too, instead of
# waiting up to 5 minutes for the scheduler's first tick. Wrapped so an
# empty/failed allowlist fetch can't abort the run before the self-check.
:do { \\
  /tool fetch url="${p.functionsBaseUrl}/ip-bindings-sync?token=${p.provisioningToken}" dst-path="echo-ipsync.rsc" mode=https; \\
  /import file-name=echo-ipsync.rsc \\
} on-error={ :put "[Echo] WARN: IP allowlist sync skipped (nothing to apply, or fetch failed)" }

# --- 12. Self-check — verifies the things this script is solely
#         responsible for actually exist, instead of trusting that "no
#         error scrolled past" means success. Added 2026-09-10 after a
#         parse-time abort in the wireless block (see section 2) silently
#         skipped every later section on wired-only hardware, and the only
#         symptom an admin could see was customers authenticating with no
#         internet — hours of debugging that this block would have made
#         obvious in one line.
:put "----------------------------------------------"
:local ok true
:if ([:len [/interface wireguard find name="echo-tunnel"]] = 0) do={ :put "[Echo] FAIL: no echo-tunnel WireGuard interface"; :set ok false }
:if ([:len [/ip firewall nat find chain=srcnat out-interface=ether1 action=masquerade]] = 0) do={ :put "[Echo] FAIL: no WAN masquerade -> customers will authenticate but have NO INTERNET"; :set ok false }
:if ([:len [/radius find comment="echo-radius"]] = 0) do={ :put "[Echo] FAIL: no RADIUS client -> vouchers can never authenticate"; :set ok false }
:if ([:len [/ip hotspot find]] = 0) do={ :put "[Echo] FAIL: no hotspot server"; :set ok false }
:if ([:len [/file find name="flash/hotspot/login.html"]] = 0) do={ :put "[Echo] FAIL: captive portal login.html missing from flash/hotspot"; :set ok false }
:if ([:len [/system scheduler find name="echo-heartbeat"]] = 0) do={ :put "[Echo] FAIL: no heartbeat scheduler -> device will show offline"; :set ok false }
:if ($ok) do={ \\
  :put "Echo provisioning complete for ${p.deviceName}. Hotspot bridge: $hsBridge" \\
} else={ \\
  :put "[Echo] PROVISIONING INCOMPLETE for ${p.deviceName} - see FAIL lines above. Re-run the setup script; if a FAIL persists, send those lines to support." }
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
  //
  // WAN bring-up has to run here too, for the same reason, and it has to
  // run FIRST — this entire bootstrap is itself the first HTTPS request the
  // router ever makes, and every earlier version of this script silently
  // depended on ether1 already having internet (true under RouterOS's
  // factory-default config, which normally includes a DHCP client on
  // ether1 — false the moment someone resets a router with "no default
  // configuration", which strips that too). Found 2026-09-10: a from-scratch
  // reset router failed at this very first step with no WAN at all, even
  // though the exact same script had worked minutes earlier on a router
  // that still had its factory-default DHCP client. `/ip address find
  // interface=ether1` (not "does a dhcp-client object exist") is the guard,
  // so this correctly no-ops whether ether1 already has an address via
  // factory-default DHCP, a prior run of this same script, or an admin's
  // own static IP — it only acts when ether1 truly has nothing.
  //
  // Deliberately ONE `;`-chained statement, not many separate lines. As
  // separate lines, a paste that drops anything after the fetch (copy-paste
  // from a web page truncating, WinBox scrollback confusion, retyping from
  // a screenshot) leaves everything before that line genuinely applied but
  // /import never runs — RouterOS just silently stops, with no error,
  // because every earlier line succeeded on its own. That exact failure
  // mode has hit real users repeatedly. As one statement, RouterOS either
  // runs the whole thing start to finish or doesn't parse it at all —
  // there's nothing left to drop partway through. :put markers give visible
  // progress instead of the bare fetch status block being the only output.
  return `:put "[Echo] 1/4 — bringing up WAN (ether1)..."; :if ([:len [/ip address find interface=ether1]] = 0) do={ /ip dhcp-client add interface=ether1 disabled=no add-default-route=yes use-peer-dns=yes }; :local wanWait 0; :while ($wanWait < 20 and [:len [/ip address find interface=ether1]] = 0) do={ :delay 1s; :set wanWait ($wanWait + 1) }; :put "[Echo] 2/4 — syncing clock..."; /system ntp client set enabled=yes; :if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }; :delay 5s; :put "[Echo] 3/4 — fetching setup script..."; /tool fetch url="${functionsBaseUrl}/provisioning-fetch?token=${provisioningToken}" dst-path="echo-setup.rsc" mode=https; :put "[Echo] 4/4 — running full setup (WireGuard, hotspot, RADIUS, captive portal)..."; /import file-name=echo-setup.rsc; :put "[Echo] Bootstrap finished. Look for 'Echo provisioning complete' just above — if it's missing, something failed partway; scroll up for the error."
`;
}
