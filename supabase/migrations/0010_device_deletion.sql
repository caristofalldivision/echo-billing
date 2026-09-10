-- Device deletion wasn't a real admin-portal flow until now — several FKs
-- referencing mikrotik_devices still had Postgres's default ON DELETE NO
-- ACTION, which would just block a delete outright the moment any voucher,
-- PPPoE account, or captive-portal theme had ever referenced that device.
-- session_history.mikrotik_device_id was the opposite problem: ON DELETE
-- CASCADE there would silently destroy historical usage/billing records
-- the moment a device row was removed, which is wrong for a billing
-- system's own accounting trail.
--
-- Fixed per-table by what actually makes sense once a device is gone:
--   pppoe_accounts, vouchers      -> SET NULL (account/voucher survives,
--                                    just becomes unassigned to a device)
--   captive_portal_themes         -> CASCADE (a per-device theme override
--                                    is meaningless without its device —
--                                    SET NULL would silently turn it into
--                                    the org-wide default theme instead,
--                                    which is a worse surprise)
--   session_history               -> SET NULL (preserve the historical
--                                    record; only the device link goes)

alter table pppoe_accounts
  drop constraint if exists pppoe_accounts_mikrotik_device_id_fkey,
  add constraint pppoe_accounts_mikrotik_device_id_fkey
    foreign key (mikrotik_device_id) references mikrotik_devices(id) on delete set null;

alter table vouchers
  drop constraint if exists vouchers_mikrotik_device_id_fkey,
  add constraint vouchers_mikrotik_device_id_fkey
    foreign key (mikrotik_device_id) references mikrotik_devices(id) on delete set null;

alter table captive_portal_themes
  drop constraint if exists captive_portal_themes_mikrotik_device_id_fkey,
  add constraint captive_portal_themes_mikrotik_device_id_fkey
    foreign key (mikrotik_device_id) references mikrotik_devices(id) on delete cascade;

alter table session_history
  drop constraint if exists session_history_mikrotik_device_id_fkey,
  add constraint session_history_mikrotik_device_id_fkey
    foreign key (mikrotik_device_id) references mikrotik_devices(id) on delete set null;
