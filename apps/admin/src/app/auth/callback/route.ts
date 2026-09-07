import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles Supabase's PKCE auth links (password recovery, email confirmation):
// exchanges the `code` query param for a session (writing the session
// cookie) before sending the browser on to its final destination.
// Only ever redirect to a same-app relative path. `${origin}${next}` below
// is plain string concatenation, not new URL(next, origin) — that happens
// to make a bare "https://evil.com" or "//evil.com" in `next` produce a
// malformed/nonexistent host rather than a clean off-site redirect today,
// but that's accidental safety from *how* it's built, not a real
// guarantee, and it'd break silently if this were ever rewritten to use
// proper URL resolution. `next` is untrusted (whoever generates the auth
// link controls it) so validate it explicitly instead of relying on that.
function safeNextPath(raw: string | null): string {
  if (raw && /^\/[^/\\]/.test(raw) && !raw.includes("://")) return raw;
  return "/settings/account";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
