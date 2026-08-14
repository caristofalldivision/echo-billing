// Lists the caller's org teammates with their email (from auth.users, which
// RLS can never expose to the client directly). Any signed-in admin can
// view the list; only owners get write actions in the Settings > Team UI.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });

    const admin = supabaseAdmin();
    const { data: rows, error } = await admin
      .from("admin_users")
      .select("id, full_name, role, created_at")
      .eq("org_id", caller.org_id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const members = await Promise.all(
      (rows ?? []).map(async (row) => {
        const { data } = await admin.auth.admin.getUserById(row.id);
        return {
          id: row.id,
          email: data.user?.email ?? null,
          full_name: row.full_name,
          role: row.role,
          created_at: row.created_at,
        };
      }),
    );

    return withCors({ members, callerId: caller.id });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
