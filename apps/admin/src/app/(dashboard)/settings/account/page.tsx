"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AccountSettingsPage() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Account</h1>
        <p className="text-sm text-signal-ink-dim">Your sign-in details.</p>
      </div>

      <div className="card flex max-w-lg flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input className="input" value={email ?? ""} disabled />
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4 border-t border-signal-border pt-4">
          <p className="text-sm font-medium">Change password</p>
          <div>
            <label className="mb-1 block text-sm font-medium">New password</label>
            <input
              className="input"
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Confirm new password</label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-signal-alert">{error}</p>}
          <button type="submit" className="btn-primary self-start" disabled={saving || !newPassword}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
