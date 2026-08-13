const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function findDeviceByTunnelIp(ip) {
  const { rows } = await pool.query(
    `select id, org_id from mikrotik_devices where host(wireguard_tunnel_ip) = $1 limit 1`,
    [ip],
  );
  return rows[0] ?? null;
}

async function claimVoucher(code) {
  const { rows } = await pool.query(
    `update vouchers
       set status = 'used', redeemed_at = now()
     where code = $1
       and status = 'unused'
       and (expires_at is null or expires_at > now())
     returning id, org_id, plan_id`,
    [code],
  );
  return rows[0] ?? null;
}

async function findPppoeAccount(username) {
  const { rows } = await pool.query(
    `select * from pppoe_accounts where username = $1 limit 1`,
    [username],
  );
  return rows[0] ?? null;
}

async function findPlan(planId) {
  const { rows } = await pool.query(`select * from plans where id = $1 limit 1`, [planId]);
  return rows[0] ?? null;
}

async function upsertActiveSession(session) {
  await pool.query(
    `insert into active_sessions
       (org_id, mikrotik_device_id, session_type, username, framed_ip, mac_address,
        acct_session_id, session_start, last_update_at, bytes_in, bytes_out)
     values ($1,$2,$3,$4,$5,$6,$7, coalesce($8, now()), now(), $9, $10)
     on conflict (mikrotik_device_id, acct_session_id) do update
       set bytes_in = excluded.bytes_in,
           bytes_out = excluded.bytes_out,
           last_update_at = now()`,
    [
      session.orgId,
      session.deviceId,
      session.sessionType,
      session.username,
      session.framedIp,
      session.macAddress,
      session.acctSessionId,
      session.sessionStart,
      session.bytesIn,
      session.bytesOut,
    ],
  );
}

async function deleteActiveSession(deviceId, acctSessionId) {
  await pool.query(
    `delete from active_sessions where mikrotik_device_id = $1 and acct_session_id = $2`,
    [deviceId, acctSessionId],
  );
}

async function inferSessionType(username) {
  const { rows } = await pool.query(
    `select 'hotspot' as type from vouchers where code = $1
     union all
     select 'pppoe' as type from pppoe_accounts where username = $1
     limit 1`,
    [username],
  );
  return rows[0]?.type ?? "hotspot";
}

async function listWireguardPeers() {
  const { rows } = await pool.query(
    `select id, name, wireguard_client_pubkey, wireguard_tunnel_ip
       from mikrotik_devices
      where wireguard_client_pubkey is not null and wireguard_tunnel_ip is not null`,
  );
  return rows;
}

module.exports = {
  pool,
  findDeviceByTunnelIp,
  claimVoucher,
  findPppoeAccount,
  findPlan,
  inferSessionType,
  upsertActiveSession,
  deleteActiveSession,
  listWireguardPeers,
};
