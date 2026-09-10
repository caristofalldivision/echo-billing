const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function findDeviceByTunnelIp(ip) {
  const { rows } = await pool.query(
    `select id, org_id from mikrotik_devices where host(wireguard_tunnel_ip) = $1 limit 1`,
    [ip],
  );
  return rows[0] ?? null;
}

// Was a strict one-shot unused->used transition: the FIRST successful auth
// burned the code forever, so anything that dropped the router's hotspot
// session before the customer's paid time actually ran out (idle-timeout,
// a router reboot clearing /ip hotspot active, walking out of range and
// back) permanently locked them out with time/data still remaining. Now
// also accepts the same code again from the SAME device (Calling-Station-Id,
// i.e. MAC) while still inside the plan's paid duration -- this is what
// makes a reconnect work without reopening the exact thing the one-shot
// design existed to prevent: a shared code letting *multiple* devices use
// one voucher at once. A different MAC is still rejected even mid-window.
// If a request genuinely carries no MAC (macAddress is null), reconnect is
// allowed regardless -- permissive fallback for that edge case rather than
// a hard failure, since MikroTik hotspot auth requests reliably include
// Calling-Station-Id in practice.
//
// Still a single atomic UPDATE...WHERE...RETURNING -- two simultaneous
// claims of the same code still can't both succeed; Postgres's row lock
// during the UPDATE serializes them, so the second one re-evaluates the
// WHERE clause against the already-updated row.
//
// $2 is explicitly cast to ::text everywhere it appears. Without the cast,
// Postgres's parameter-type inference (which runs against the query text
// alone, before any values are bound) fails with "could not determine data
// type of parameter $2" the moment `$2 is null` appears as one branch of an
// OR — even though `v.claimed_mac_address = $2` elsewhere in the very same
// OR would otherwise resolve it to text. Confirmed live: this was silently
// rejecting every single claimVoucher call in production (found 2026-09-10
// via radius-service's Fly logs — every real router auth attempt showed
// "authenticate() error ... 42P08" followed by REJECT), which is what made
// vouchers show "valid" on the captive portal but never actually connect —
// check-voucher only validates the code, claimVoucher (via RADIUS) is what
// actually grants access, and it was unconditionally failing regardless of
// which code or MAC was passed in. Reproduced and verified fixed by
// round-tripping this exact query against the live DB before deploying.
async function claimVoucher(code, macAddress) {
  const { rows } = await pool.query(
    `update vouchers v
        set status = 'used',
            redeemed_at = coalesce(v.redeemed_at, now()),
            claimed_mac_address = coalesce(v.claimed_mac_address, $2::text)
       from plans p
      where v.code = $1
        and v.plan_id = p.id
        and (
             (v.status = 'unused' and (v.expires_at is null or v.expires_at > now()))
          or (
               v.status = 'used'
               and (v.claimed_mac_address is null or $2::text is null or v.claimed_mac_address = $2::text)
               and (p.duration_minutes is null or v.redeemed_at + (p.duration_minutes || ' minutes')::interval > now())
             )
           )
      returning v.id, v.org_id, v.plan_id`,
    [code, macAddress ?? null],
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
  // Was a plain delete — the row (and its bytes_in/bytes_out) just vanished
  // on Stop, so "data used" could only ever reflect whoever happened to be
  // online right now. Moves it into session_history instead, in one atomic
  // statement so there's no window where the session exists in neither
  // table if this crashes mid-way.
  await pool.query(
    `with moved as (
       delete from active_sessions
        where mikrotik_device_id = $1 and acct_session_id = $2
       returning *
     )
     insert into session_history
       (org_id, mikrotik_device_id, session_type, username, framed_ip, mac_address,
        acct_session_id, session_start, session_end, bytes_in, bytes_out)
     select org_id, mikrotik_device_id, session_type, username, framed_ip, mac_address,
            acct_session_id, session_start, now(), bytes_in, bytes_out
       from moved`,
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
