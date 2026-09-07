alter table vouchers
  add column if not exists claimed_mac_address text;
