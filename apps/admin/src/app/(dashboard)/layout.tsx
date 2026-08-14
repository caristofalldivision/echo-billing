import { Sidebar } from "@/components/Sidebar";
import { SignOutButton } from "@/components/SignOutButton";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let fullName: string | null = null;
  let hasAccess = false;
  if (user) {
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    hasAccess = !!adminUser;
    fullName = adminUser?.full_name ?? user.email ?? null;
  }

  if (user && !hasAccess) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display text-xl font-bold text-echo-ink">No access yet</h1>
        <p className="max-w-sm text-sm text-echo-muted">
          Your account ({user.email}) isn&apos;t linked to an organization. Ask your admin to add you
          from Settings &gt; Team, or sign out and try a different account.
        </p>
        <SignOutButton />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-echo-indigo-100/70 bg-white/60 px-8 py-4 backdrop-blur">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-echo-muted">{fullName}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
