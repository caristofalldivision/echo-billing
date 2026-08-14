"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/functions";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [orgExists, setOrgExists] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("org-exists");
      if (error) {
        setCheckError("Couldn't check setup status. Please try again in a moment.");
      } else {
        setOrgExists(!!data?.exists);
      }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    const { error: bootstrapError } = await supabase.functions.invoke("org-bootstrap", {
      body: { orgName, fullName },
    });
    setLoading(false);
    if (bootstrapError) {
      setError(
        await getFunctionErrorMessage(
          bootstrapError,
          "Couldn't finish setting up your organization. If someone else just signed up first, sign in instead.",
        ),
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/logo-mark.svg" alt="Echo" className="h-14 w-14" />
          <h1 className="font-display text-2xl font-bold text-echo-ink">Echo</h1>
          <p className="text-sm text-echo-muted">Set up your billing admin portal</p>
        </div>

        {checking ? (
          <div className="card text-center text-sm text-echo-muted">Checking setup status…</div>
        ) : checkError ? (
          <div className="card flex flex-col gap-3 text-center">
            <p className="text-sm text-echo-coral-500">{checkError}</p>
          </div>
        ) : orgExists ? (
          <div className="card flex flex-col gap-3 text-center">
            <p className="text-sm text-echo-muted">
              This Echo instance is already set up. Ask your administrator for an account.
            </p>
            <Link href="/login" className="btn-primary">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Organization name</label>
              <input
                className="input"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Your ISP name"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Your full name</label>
              <input
                className="input"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
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
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Confirm password</label>
              <input
                className="input"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-echo-coral-500">{error}</p>}
            <button type="submit" className="btn-primary mt-2" disabled={loading}>
              {loading ? "Setting up…" : "Create organization"}
            </button>
            <p className="text-center text-xs text-echo-muted">
              Already set up?{" "}
              <Link href="/login" className="font-medium text-echo-indigo-500">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
