"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  return (
    <button
      className="text-sm font-medium text-signal-ink-dim hover:text-signal-ink"
      onClick={async () => {
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
