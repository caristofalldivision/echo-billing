-- Echo billing system — MikroTik provisioning correctness fixes
--
-- WireGuard tunnel IPs were assigned by counting existing devices
-- (`count + 2`), which is not atomic: two admins provisioning at once, or
-- provisioning after a device was deleted, can produce two routers with the
-- identical 10.77.0.x tunnel address — a real network conflict. This moves
-- assignment into a locked, atomic function.

create or replace function next_wireguard_tunnel_ip(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  lock table mikrotik_devices in share row exclusive mode;

  select coalesce(max(split_part(host(wireguard_tunnel_ip), '.', 4)::int), 1) + 1
    into v_next
  from mikrotik_devices
  where org_id = p_org_id and wireguard_tunnel_ip is not null;

  if v_next < 2 then
    v_next := 2; -- .1 is reserved for radius-service
  end if;

  return '10.77.0.' || v_next || '/32';
end;
$$;

revoke all on function next_wireguard_tunnel_ip(uuid) from public, anon, authenticated;
