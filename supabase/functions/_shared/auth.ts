import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabase.ts";

export interface CallerAdmin {
  id: string;
  org_id: string;
  role: "owner" | "staff";
}

/**
 * Resolves the Supabase auth user making this request from its JWT. Returns
 * null if the Authorization header is missing or the token is invalid.
 */
export async function getCallerUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  return user;
}

/**
 * Resolves the calling admin_users row from the request's Supabase auth JWT.
 * Returns null if the JWT is missing/invalid or the caller has no
 * admin_users row (e.g. an auth user who never completed org-bootstrap).
 */
export async function getCallerAdmin(req: Request): Promise<CallerAdmin | null> {
  const user = await getCallerUser(req);
  if (!user) return null;

  const { data } = await supabaseAdmin()
    .from("admin_users")
    .select("id, org_id, role")
    .eq("id", user.id)
    .maybeSingle();

  return (data as CallerAdmin | null) ?? null;
}
