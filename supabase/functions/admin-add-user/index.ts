// Owner-only: creates a new admin_users account with a one-time temporary
// password. The password is returned once so the owner can relay it
// manually — the new hire changes it from Settings > Account after first
// sign-in. No email dependency, so this works before Resend is configured.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getCallerAdmin } from "../_shared/auth.ts";

// Unambiguous charset — no 0/O/1/I/l — since this gets read aloud/typed by hand.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generateTempPassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  try {
    const caller = await getCallerAdmin(req);
    if (!caller) return withCors({ error: "Not authorized" }, { status: 403 });
    if (caller.role !== "owner") {
      return withCors({ error: "Only owners can add team members" }, { status: 403 });
    }

    const { email, fullName, role } = await req.json();
    if (!email || typeof email !== "string") {
      return withCors({ error: "email is required" }, { status: 400 });
    }
    if (role !== "owner" && role !== "staff") {
      return withCors({ error: "role must be 'owner' or 'staff'" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const tempPassword = generateTempPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createError) return withCors({ error: createError.message }, { status: 400 });

    const { error: insertError } = await admin.from("admin_users").insert({
      id: created.user.id,
      org_id: caller.org_id,
      full_name: fullName || null,
      role,
    });
    if (insertError) {
      // Roll back the auth user so we don't leave an orphaned account behind.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw insertError;
    }

    return withCors({ id: created.user.id, email, tempPassword });
  } catch (err) {
    return withCors({ error: (err as Error).message }, { status: 500 });
  }
});
