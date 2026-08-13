import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Service-role client — bypasses RLS. Only ever used inside edge functions,
 * never shipped to a browser. Functions that serve the public captive
 * portal or webhooks rely on this plus their own request-level checks
 * (device token / IPN signature / etc) instead of a user JWT.
 */
export function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function getOrgSettings(orgId?: string) {
  const supabase = supabaseAdmin();
  const query = supabase.from("organizations").select("*").limit(1);
  const { data, error } = orgId
    ? await query.eq("id", orgId).single()
    : await query.single();
  if (error) throw error;
  return data;
}
