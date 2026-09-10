// Ops tool: read a provisioned router's live config over the WireGuard
// tunnel, using the per-device MikroTik API user the provisioning script
// creates (section 8, policy=api,read,write,rest-api). radius-service is
// the only piece of Echo that sits on the tunnel, so it's the only place
// this can run from — hence a script here rather than an edge function.
//
//   fly ssh console -a echo-radius -C "node /app/src/router-diag.js"
//   fly ssh console -a echo-radius -C "node /app/src/router-diag.js Test1"
//
// Read-only: every path below is a GET. Exists because diagnosing
// "authenticates but no internet" from the outside is guesswork — the
// answer is always in the router's own NAT/route/hotspot tables, and
// asking an admin to paste WinBox output is slow, truncation-prone (the
// terminal pager silently cuts long tables), and needs them on-site.
const db = require("./db");
const http = require("http");

// What actually matters for the failure modes documented in CLAUDE.md:
// missing WAN masquerade (authenticates but no internet), missing default
// route, stale schedulers still carrying a deleted device's provisioning
// token, and which DNS the DHCP server hands out.
const PATHS = [
  ["NAT rules", "/rest/ip/firewall/nat"],
  ["Filter rules", "/rest/ip/firewall/filter"],
  ["Routes", "/rest/ip/route"],
  ["Addresses", "/rest/ip/address"],
  ["DHCP networks", "/rest/ip/dhcp-server/network"],
  ["DNS", "/rest/ip/dns"],
  ["Hotspot servers", "/rest/ip/hotspot"],
  ["Hotspot profiles", "/rest/ip/hotspot/profile"],
  ["RADIUS clients", "/rest/radius"],
  ["Schedulers", "/rest/system/scheduler"],
  ["WireGuard peers", "/rest/interface/wireguard/peers"],
];

function get(host, auth, path) {
  return new Promise((resolve) => {
    const req = http.get({ host, path, auth, timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "timeout" });
    });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
  });
}

async function main() {
  const wanted = process.argv[2];
  const { rows } = await db.pool.query(
    `select name, host(wireguard_tunnel_ip) as ip, mikrotik_api_username as u, mikrotik_api_password as p
       from mikrotik_devices
      where wireguard_tunnel_ip is not null and mikrotik_api_username is not null
        and ($1::text is null or name = $1::text)
      order by created_at desc`,
    [wanted ?? null],
  );

  if (!rows.length) {
    console.log("no devices with a tunnel IP + API user found");
    return;
  }

  for (const d of rows) {
    const auth = `${d.u}:${d.p}`;
    console.log(`\n########## ${d.name} (${d.ip}) ##########`);
    const probe = await get(d.ip, auth, "/rest/system/resource");
    if (probe.status !== 200) {
      console.log(`  UNREACHABLE via REST (${probe.status}): ${probe.body.slice(0, 200)}`);
      console.log("  -> tunnel down, or /ip service www disabled, or API user wrong.");
      continue;
    }
    for (const [label, path] of PATHS) {
      const r = await get(d.ip, auth, path);
      console.log(`\n--- ${label} (${r.status}) ---`);
      try {
        console.log(JSON.stringify(JSON.parse(r.body), null, 1).slice(0, 4000));
      } catch {
        console.log(r.body.slice(0, 1000));
      }
    }
  }
}

main()
  .catch((e) => console.error("router-diag error", e))
  .finally(() => db.pool.end());
