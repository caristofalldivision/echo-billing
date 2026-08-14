// Public — lets the /signup page self-gate before rendering the form.
// Called by anonymous browsers, so no Supabase auth JWT is available.
import { handlePreflight, withCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const { count, error } = await supabaseAdmin()
    .from("organizations")
    .select("id", { count: "exact", head: true });
  if (error) return withCors({ error: error.message }, { status: 500 });

  return withCors({ exists: (count ?? 0) > 0 });
});
