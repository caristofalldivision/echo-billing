// Owner-only: changes a teammate's role. Blocks demoting the last owner in
// the org, since that would leave nobody able to manage the team or org
// settings.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });
    if (caller.role !== "owner") {
      return withCors({ error: "Only owners can change roles" }, { status: 403 });
    }

    const { userId, role } = await req.json();
    if (role !== "owner" && role !== "staff") {
      return withCors({ error: "role must be 'owner' or 'staff'" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: target, error: targetError } = await admin
      .from("admin_users")
      .select("id, org_id, role")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.org_id !== caller.org_id) {
      return withCors({ error: "User not found in your organization" }, { status: 404 });
    }

    if (target.role === "owner" && role === "staff") {
      const { count, error: countError } = await admin
        .from("admin_users")
        .select("id", { count: "exact", head: true })
        .eq("org_id", caller.org_id)
        .eq("role", "owner");
      if (countError) throw countError;
      if ((count ?? 0) <= 1) {
        return withCors({ error: "You can't remove the last owner." }, { status: 400 });
      }
    }

    const { error } = await admin.from("admin_users").update({ role }).eq("id", userId);
    if (error) throw error;

    return withCors({ ok: true });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
