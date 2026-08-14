const dgram = require("dgram");
const radius = require("radius");
const bcrypt = require("bcryptjs");
const db = require("./db");

// Hotspot logins use a voucher code as both username and password (see
// apps/captive-portal — it auto-fills the MikroTik login form that way).
// PPPoE logins use the account's real username/password.
async function authenticate(username, password) {
  // Only attempt to claim when the password actually matches the voucher
  // convention — claimVoucher() marks the code used, so calling it on a
  // mismatched attempt would burn a customer's paid voucher without ever
  // granting access.
  if (password === username) {
    const voucher = await db.claimVoucher(username);
    if (voucher) {
      const plan = await db.findPlan(voucher.plan_id);
      return { accept: true, orgId: voucher.org_id, sessionType: "hotspot", plan };
    }
  }

  const account = await db.findPppoeAccount(username);
  if (account && bcrypt.compareSync(password, account.password_hash)) {
    if (account.status !== "active") return { accept: false };
    if (account.expires_at && new Date(account.expires_at) < new Date()) return { accept: false };
    const plan = account.plan_id ? await db.findPlan(account.plan_id) : null;
    return { accept: true, orgId: account.org_id, sessionType: "pppoe", plan };
  }

  return { accept: false };
}

function startAuthServer({ port, secret }) {
  const socket = dgram.createSocket("udp4");

  socket.on("message", async (msg, rinfo) => {
    let packet;
    try {
      packet = radius.decode({ packet: msg, secret });
    } catch (err) {
      console.error("radius-auth: failed to decode packet", err.message);
      return;
    }
    if (packet.code !== "Access-Request") return;

    const username = packet.attributes["User-Name"];
    const password = packet.attributes["User-Password"];

    let result = { accept: false };
    try {
      result = await authenticate(username, password);
    } catch (err) {
      console.error("radius-auth: authenticate() error", err);
    }

    const attributes = [];
    if (result.accept && result.plan) {
      if (result.plan.duration_minutes) {
        attributes.push(["Session-Timeout", result.plan.duration_minutes * 60]);
      }
      // Bandwidth shaping (Mikrotik-Rate-Limit) needs the Mikrotik vendor
      // dictionary loaded — follow-up, see radius-service/README.md.
    }

    const response = radius.encode_response({
      packet,
      code: result.accept ? "Access-Accept" : "Access-Reject",
      secret,
      attributes,
    });

    socket.send(response, 0, response.length, rinfo.port, rinfo.address);
    console.log(
      `radius-auth: ${username} -> ${result.accept ? "ACCEPT" : "REJECT"} (${rinfo.address})`,
    );
  });

  socket.on("error", (err) => console.error("radius-auth socket error", err));
  socket.bind(port, () => console.log(`radius-auth listening on udp/${port}`));
  return socket;
}

module.exports = { startAuthServer, authenticate };
