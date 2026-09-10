const dgram = require("dgram");
const radius = require("radius");
const db = require("./db");

function startAcctServer({ port, secret }) {
  const socket = dgram.createSocket("udp4");

  socket.on("message", async (msg, rinfo) => {
    let packet;
    try {
      packet = radius.decode({ packet: msg, secret });
    } catch (err) {
      console.error("radius-acct: failed to decode packet", err.message);
      return;
    }
    if (packet.code !== "Accounting-Request") return;

    // Ack immediately — RouterOS resends if it doesn't hear back quickly,
    // and none of our bookkeeping below should hold up the NAS.
    const response = radius.encode_response({ packet, code: "Accounting-Response", secret });
    socket.send(response, 0, response.length, rinfo.port, rinfo.address);

    try {
      await handleAccounting(packet, rinfo.address);
    } catch (err) {
      console.error("radius-acct: handleAccounting error", err);
    }
  });

  socket.on("error", (err) => console.error("radius-acct socket error", err));
  socket.bind(port, () => console.log(`radius-acct listening on udp/${port}`));
  return socket;
}

async function handleAccounting(packet, sourceIp) {
  const device = await db.findDeviceByTunnelIp(sourceIp);
  if (!device) {
    console.warn(`radius-acct: no device found for tunnel ip ${sourceIp}`);
    return;
  }

  const statusType = packet.attributes["Acct-Status-Type"];
  const username = packet.attributes["User-Name"];
  const acctSessionId = packet.attributes["Acct-Session-Id"];
  if (!username || !acctSessionId) return;

  if (statusType === "Stop") {
    // Pass the Stop packet's own final octet counters through — without
    // them a session that never sent an interim update was archived as
    // 0 bytes regardless of real usage (see deleteActiveSession).
    const finalIn = Number(packet.attributes["Acct-Input-Octets"] ?? 0);
    const finalOut = Number(packet.attributes["Acct-Output-Octets"] ?? 0);
    await db.deleteActiveSession(device.id, acctSessionId, finalIn, finalOut);
    console.log(
      `radius-acct: session stop ${username} (${acctSessionId}) in=${finalIn} out=${finalOut}`,
    );
    return;
  }

  const sessionType = await db.inferSessionType(username);

  await db.upsertActiveSession({
    orgId: device.org_id,
    deviceId: device.id,
    sessionType,
    username,
    framedIp: packet.attributes["Framed-IP-Address"] ?? null,
    macAddress: packet.attributes["Calling-Station-Id"] ?? null,
    acctSessionId,
    sessionStart: statusType === "Start" ? new Date() : null,
    bytesIn: Number(packet.attributes["Acct-Input-Octets"] ?? 0),
    bytesOut: Number(packet.attributes["Acct-Output-Octets"] ?? 0),
  });
  console.log(`radius-acct: session ${statusType} ${username} (${acctSessionId})`);
}

module.exports = { startAcctServer };
