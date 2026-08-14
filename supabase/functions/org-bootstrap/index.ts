// Completes signup for the very first admin: the caller must already have a
// Supabase auth session (created client-side via supabase.auth.signUp)
// but no admin_users row yet. Creates the single organizations row and
// makes the caller its owner. Rejects — and cleans up the orphaned auth
// user — if an organization already exists.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getCallerUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const user = await getCallerUser(req);
    if (!user) return withCors({ error: "Not authenticated" }, { status: 401 });

    const { orgName, fullName } = await req.json();
    const admin = supabaseAdmin();

    const { data: orgId, error } = await admin.rpc("bootstrap_organization", {
      p_org_name: orgName ?? "",
      p_owner_id: user.id,
      p_owner_full_name: fullName ?? "",
    });

    if (error) {
      if (error.message?.includes("organization_exists")) {
        // Clean up the auth user created for this failed attempt so the
        // email is free to try again (e.g. signing in once invited).
        await admin.auth.admin.deleteUser(user.id).catch(() => {});
        return withCors(
          { error: "This Echo instance is already set up. Ask your administrator for an account." },
          { status: 409 },
        );
      }
      throw error;
    }

    return withCors({ orgId });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
