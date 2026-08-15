"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PaymentsSettingsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState("");
  const [env, setEnv] = useState<"sandbox" | "live">("sandbox");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("*").single();
      if (data) {
        setOrgId(data.id);
        setEnv(data.pesapal_env);
        setConsumerKey(data.pesapal_consumer_key ?? "");
        setConsumerSecret(data.pesapal_consumer_secret ?? "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase
      .from("organizations")
      .update({
        pesapal_env: env,
        pesapal_consumer_key: consumerKey,
        pesapal_consumer_secret: consumerSecret,
      })
      .eq("id", orgId);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Payments — Pesapal</h1>
        <p className="text-sm text-signal-ink-dim">Used for card payments and M-Pesa STK push.</p>
      </div>

      <form onSubmit={handleSave} className="card flex max-w-lg flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Environment</label>
          <select className="input" value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "live")}>
            <option value="sandbox">Sandbox</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Consumer key</label>
          <input className="input" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Consumer secret</label>
          <input
            className="input"
            type="password"
            value={consumerSecret}
            onChange={(e) => setConsumerSecret(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        <p className="text-xs text-signal-ink-dim">
          Find these in your Pesapal merchant dashboard under API Keys. The IPN endpoint is registered
          automatically on the first order.
        </p>
      </form>
    </div>
  );
}
