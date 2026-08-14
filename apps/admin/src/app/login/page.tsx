"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email above first, then click \"Forgot password?\"");
      return;
    }
    setError(null);
    setResetting(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/settings/account`,
    });
    setResetting(false);
    setResetSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/logo-mark.svg" alt="Echo" className="h-14 w-14" />
          <h1 className="font-display text-2xl font-bold text-echo-ink">Echo</h1>
          <p className="text-sm text-echo-muted">Sign in to your billing admin portal</p>
        </div>

        <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourisp.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-echo-coral-500">{error}</p>}
          {resetSent && (
            <p className="text-sm text-echo-mint-500">
              If an account exists for that email, a reset link is on its way.
            </p>
          )}
          <button type="submit" className="btn-primary mt-2" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="text-center text-xs font-medium text-echo-indigo-500"
            onClick={handleForgotPassword}
            disabled={resetting}
          >
            {resetting ? "Sending…" : "Forgot password?"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-echo-muted">
          Setting up Echo for the first time?{" "}
          <Link href="/signup" className="font-medium text-echo-indigo-500">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
