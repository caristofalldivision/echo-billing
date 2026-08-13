import { Sidebar } from "@/components/Sidebar";
import { SignOutButton } from "@/components/SignOutButton";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let fullName: string | null = null;
  if (user) {
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    fullName = adminUser?.full_name ?? user.email ?? null;
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
