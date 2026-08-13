// Hand-written subset of the generated Supabase types, covering the columns
// the admin portal actually reads/writes. Once you have a live project,
// replace this with the real output of:
//   supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts

export interface Organization {
  id: string;
  name: string;
  support_phone: string | null;
  support_email: string | null;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_logo_url: string | null;
  pesapal_env: "sandbox" | "live";
  pesapal_consumer_key: string | null;
  pesapal_consumer_secret: string | null;
  pesapal_ipn_id: string | null;
  talksasa_api_key: string | null;
  talksasa_sender_id: string | null;
  resend_api_key: string | null;
  resend_from_email: string | null;
  resend_from_name: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  org_id: string;
  full_name: string | null;
  role: "owner" | "staff";
  created_at: string;
}

export interface MikrotikDevice {
  id: string;
  org_id: string;
  name: string;
  site: string | null;
  model: string | null;
  routeros_version: string | null;
  public_ip: string | null;
  wireguard_server_pubkey: string | null;
  wireguard_client_pubkey: string | null;
  wireguard_client_privkey: string | null;
  wireguard_tunnel_ip: string | null;
  mikrotik_api_username: string | null;
  mikrotik_api_password: string | null;
  provisioning_token: string;
  status: "pending" | "linked" | "offline" | "error";
  last_seen_at: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  org_id: string;
  type: "hotspot" | "pppoe";
  name: string;
  description: string | null;
  price: number;
  currency: string;
  duration_minutes: number | null;
  data_cap_mb: number | null;
  speed_down_kbps: number | null;
  speed_up_kbps: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  org_id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  type: "hotspot" | "pppoe" | "both";
  created_at: string;
}

export interface PppoeAccount {
  id: string;
  org_id: string;
  customer_id: string | null;
  username: string;
  password_hash: string;
  plan_id: string | null;
  mikrotik_device_id: string | null;
  status: "active" | "suspended" | "expired";
  expires_at: string | null;
  created_at: string;
}

export interface Voucher {
  id: string;
  org_id: string;
  code: string;
  plan_id: string;
  mikrotik_device_id: string | null;
  batch_id: string;
  status: "unused" | "used" | "expired" | "revoked";
  created_by: string | null;
  redeemed_by_customer_id: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ActiveSession {
  id: string;
  org_id: string;
  mikrotik_device_id: string | null;
  session_type: "hotspot" | "pppoe";
  username: string;
  framed_ip: string | null;
  mac_address: string | null;
  acct_session_id: string;
  session_start: string;
  last_update_at: string;
  bytes_in: number;
  bytes_out: number;
}

export interface Transaction {
  id: string;
  org_id: string;
  customer_id: string | null;
  voucher_id: string | null;
  pppoe_account_id: string | null;
  plan_id: string;
  amount: number;
  currency: string;
  method: "mpesa_stk" | "card" | "manual";
  status: "pending" | "completed" | "failed" | "cancelled";
  phone: string | null;
  pesapal_order_tracking_id: string | null;
  pesapal_merchant_reference: string;
  created_at: string;
  completed_at: string | null;
}

export interface CaptivePortalTheme {
  id: string;
  org_id: string;
  mikrotik_device_id: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  doodle_set: string;
  headline: string;
  tagline: string | null;
  terms_text: string | null;
  support_phone: string | null;
  support_whatsapp: string | null;
  updated_at: string;
}

type TableDef<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row> };

export interface Database {
  public: {
    Tables: {
      organizations: TableDef<Organization>;
      admin_users: TableDef<AdminUser>;
      mikrotik_devices: TableDef<MikrotikDevice>;
      plans: TableDef<Plan>;
      customers: TableDef<Customer>;
      pppoe_accounts: TableDef<PppoeAccount>;
      vouchers: TableDef<Voucher>;
      active_sessions: TableDef<ActiveSession>;
      transactions: TableDef<Transaction>;
      captive_portal_themes: TableDef<CaptivePortalTheme>;
    };
  };
}
