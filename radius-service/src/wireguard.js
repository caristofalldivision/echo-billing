const { execSync } = require("child_process");
const db = require("./db");

const IFACE = process.env.WIREGUARD_INTERFACE || "wg0";

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

// Idempotent — safe to call on every boot. Requires NET_ADMIN + wireguard-tools
// (see Dockerfile). No-ops with a warning if the interface can't be created,
// so local `npm run dev` without root doesn't crash the whole process.
function bootstrapInterface() {
  try {
    sh(`ip link show ${IFACE}`);
  } catch {
    try {
      sh(`ip link add dev ${IFACE} type wireguard`);
      sh(`ip address add ${process.env.WIREGUARD_SERVER_ADDRESS} dev ${IFACE}`);
      const privkeyPath = "/run/wg-private.key";
      require("fs").writeFileSync(privkeyPath, process.env.WIREGUARD_SERVER_PRIVATE_KEY + "\n", {
        mode: 0o600,
      });
      sh(`wg set ${IFACE} listen-port ${process.env.WIREGUARD_LISTEN_PORT} private-key ${privkeyPath}`);
      sh(`ip link set up dev ${IFACE}`);
      console.log(`wireguard: created and brought up ${IFACE}`);
    } catch (err) {
      console.warn(
        `wireguard: could not create ${IFACE} (needs NET_ADMIN + wireguard-tools) — ${err.message}`,
      );
    }
  }
}

// Reconciles wg0's peer list against mikrotik_devices. Additive only for
// now (removing a device in the admin portal doesn't yet tear down its
// peer) — acceptable for the initial rollout, tighten up once device
// deletion is a real admin-portal flow.
async function syncPeers() {
  let peers;
  try {
    peers = await db.listWireguardPeers();
  } catch (err) {
    console.error("wireguard: could not list peers from db", err.message);
    return;
  }

  for (const peer of peers) {
    const allowedIp = peer.wireguard_tunnel_ip; // already a /32
    try {
      sh(
        `wg set ${IFACE} peer ${peer.wireguard_client_pubkey} allowed-ips ${allowedIp}`,
      );
    } catch (err) {
      console.warn(`wireguard: failed to sync peer for device ${peer.name} — ${err.message}`);
    }
  }
}

function startPeerSyncLoop(intervalMs) {
  syncPeers();
  return setInterval(syncPeers, intervalMs);
}

module.exports = { bootstrapInterface, syncPeers, startPeerSyncLoop };
