const crypto = require("crypto");
const path = require("path");
const dgram = require("dgram");
const radius = require("radius");
const bcrypt = require("bcryptjs");
const db = require("./db");

// Loads Mikrotik-Rate-Limit (vendor 14988, attr 8) so it can be encoded by
// name below — radius.encode_attributes throws "unknown attribute" for any
// name it can't resolve against a loaded dictionary, so this has to run
// before any Access-Accept tries to include it.
radius.add_dictionary(path.join(__dirname, "mikrotik.dictionary"));

// MikroTik hotspot talks to RADIUS via CHAP by default — even though the
// browser just POSTs a plain username/password to the router itself, the
// router computes a CHAP response from what the customer typed before
// relaying to RADIUS. CHAP-Password is 1 byte CHAP Ident + 16 byte MD5
// digest of (ident || candidate-password || challenge).
function chapMatches(candidate, chapId, chapPassword, chapChallenge) {
  const digest = crypto
    .createHash("md5")
    .update(Buffer.from([chapId]))
    .update(Buffer.from(candidate, "utf8"))
    .update(chapChallenge)
    .digest();
  return digest.equals(chapPassword);
}

// Hotspot logins use a voucher code as both username and password (see
// apps/captive-portal — it auto-fills the MikroTik login form that way).
// PPPoE logins use the account's real username/password.
//
// CHAP verification means "does this candidate password hash to what was
// sent" rather than "here's the plaintext" — that only works for vouchers,
// since the code is stored in the clear. PPPoE passwords are bcrypt-hashed
// and can't be reversed to compute a CHAP digest, so PPPoE only works over
// PAP; if a router ever sends PPPoE auth via CHAP it will fail here rather
// than silently misauthenticating.
async function authenticate({ username, password, chapId, chapPassword, chapChallenge, macAddress }) {
  const isChap = Boolean(chapPassword && chapChallenge);

  function matches(candidate) {
    return isChap ? chapMatches(candidate, chapId, chapPassword, chapChallenge) : candidate === password;
  }

  // Only attempt to claim when the password actually matches the voucher
  // convention — claimVoucher() marks the code used, so calling it on a
  // mismatched attempt would burn a customer's paid voucher without ever
  // granting access. macAddress lets claimVoucher recognize "this is the
  // same device reconnecting within its paid window" versus a different
  // device trying to reuse a shared code — see the long comment on
  // claimVoucher itself in db.js.
  if (matches(username)) {
    const voucher = await db.claimVoucher(username, macAddress);
    if (voucher) {
      const plan = await db.findPlan(voucher.plan_id);
      return { accept: true, orgId: voucher.org_id, sessionType: "hotspot", plan };
    }
  }

  if (!isChap) {
    const account = await db.findPppoeAccount(username);
    if (account && bcrypt.compareSync(password, account.password_hash)) {
      if (account.status !== "active") return { accept: false };
      if (account.expires_at && new Date(account.expires_at) < new Date()) return { accept: false };
      const plan = account.plan_id ? await db.findPlan(account.plan_id) : null;
      return { accept: true, orgId: account.org_id, sessionType: "pppoe", plan };
    }
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
    const chapPasswordRaw = packet.attributes["CHAP-Password"];
    const chapChallenge = packet.attributes["CHAP-Challenge"];
    const macAddress = packet.attributes["Calling-Station-Id"] ?? null;

    let chapId, chapPassword;
    if (Buffer.isBuffer(chapPasswordRaw) && chapPasswordRaw.length === 17) {
      chapId = chapPasswordRaw[0];
      chapPassword = chapPasswordRaw.subarray(1);
    }

    let result = { accept: false };
    try {
      result = await authenticate({ username, password, chapId, chapPassword, chapChallenge, macAddress });
    } catch (err) {
      console.error("radius-auth: authenticate() error", err);
    }

    const attributes = [];
    if (result.accept && result.plan) {
      if (result.plan.duration_minutes) {
        attributes.push(["Session-Timeout", result.plan.duration_minutes * 60]);
      }
      // rx/tx here is from the router's own point of view, per MikroTik's
      // hotspot RADIUS convention: rx = what the router receives FROM the
      // client (the client's upload), tx = what it transmits TO the client
      // (the client's download). Not verified against a live router in this
      // change — worth confirming upload/download land the right way round
      // the first time a speed-limited plan is actually tested.
      //
      // Vendor-specific attributes can't be encoded flat by name — they
      // have to be wrapped in the base RFC2865 Vendor-Specific attribute
      // (type 26) with the vendor id and the real attribute nested inside,
      // or radius.encode_attributes throws "unknown attribute" looking for
      // "Mikrotik-Rate-Limit" in the top-level (non-vendor) dictionary
      // namespace instead of the vendor-14988 one it was actually loaded
      // into. Confirmed by round-tripping encode/decode in isolation before
      // wiring this in — see git history for the throwaway test script.
      const rx = result.plan.speed_up_kbps;
      const tx = result.plan.speed_down_kbps;
      if (rx || tx) {
        attributes.push(["Vendor-Specific", 14988, [["Mikrotik-Rate-Limit", `${rx || tx}k/${tx || rx}k`]]]);
      }
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
