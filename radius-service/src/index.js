require("dotenv").config();

const { startAuthServer } = require("./radius-auth");
const { startAcctServer } = require("./radius-acct");
const { bootstrapInterface, startPeerSyncLoop } = require("./wireguard");

const secret = process.env.RADIUS_SHARED_SECRET;
if (!secret || secret === "change-me") {
  console.warn("WARNING: RADIUS_SHARED_SECRET is unset or default — set a real secret before exposing this publicly.");
}

bootstrapInterface();
startPeerSyncLoop(Number(process.env.WIREGUARD_PEER_SYNC_INTERVAL_MS) || 30000);

startAuthServer({ port: Number(process.env.RADIUS_AUTH_PORT) || 1812, secret });
startAcctServer({ port: Number(process.env.RADIUS_ACCT_PORT) || 1813, secret });

process.on("SIGTERM", () => process.exit(0));
