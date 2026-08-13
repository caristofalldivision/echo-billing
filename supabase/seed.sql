-- Local dev seed data. Not applied to production projects.

insert into organizations (id, name, support_phone, support_email)
values ('00000000-0000-0000-0000-000000000001', 'Echo Demo ISP', '+254700000000', 'support@echo.test')
on conflict (id) do nothing;

insert into plans (org_id, type, name, description, price, duration_minutes, data_cap_mb, speed_down_kbps, speed_up_kbps)
values
  ('00000000-0000-0000-0000-000000000001', 'hotspot', '1 Hour', 'Quick browsing pass', 10, 60, 500, 4096, 1024),
  ('00000000-0000-0000-0000-000000000001', 'hotspot', '24 Hours', 'Full day access', 50, 1440, 3000, 8192, 2048),
  ('00000000-0000-0000-0000-000000000001', 'pppoe', 'Home 10Mbps', 'Monthly unlimited', 1500, null, null, 10240, 5120)
on conflict do nothing;

-- After creating your first user via Supabase Auth locally, link it as an
-- owner with:
--   insert into admin_users (id, org_id, full_name, role)
--   values ('<auth.users.id>', '00000000-0000-0000-0000-000000000001', 'You', 'owner');
