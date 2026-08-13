"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function EmailSettingsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("Echo");
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("*").single();
      if (data) {
        setOrgId(data.id);
        setApiKey(data.resend_api_key ?? "");
        setFromEmail(data.resend_from_email ?? "");
        setFromName(data.resend_from_name);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase
      .from("organizations")
      .update({ resend_api_key: apiKey, resend_from_email: fromEmail, resend_from_name: fromName })
      .eq("id", orgId);
    setSaving(false);
  }

  async function handleTest() {
    setTestStatus("Sending…");
    const { error } = await supabase.functions.invoke("email-send", {
      body: {
        to: testEmail,
        subject: "Echo test email",
        html: "<p>This is a test email from Echo billing.</p>",
        template: "test",
      },
    });
    setTestStatus(error ? `Failed: ${error.message}` : "Sent ✓");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-echo-ink">Email — Resend</h1>
        <p className="text-sm text-echo-muted">Payment receipts and account notices.</p>
      </div>

      <form onSubmit={handleSave} className="card flex max-w-lg flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">API key</label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">From email</label>
          <input className="input" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="billing@yourisp.com" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">From name</label>
          <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <p className="text-xs text-echo-muted">
          The from-email domain must be verified in your Resend dashboard before sends will succeed.
        </p>
      </form>

      <div className="card flex max-w-lg flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Send a test email</h2>
        <div className="flex gap-3">
          <input
            className="input"
            placeholder="you@example.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <button className="btn-secondary shrink-0" onClick={handleTest} disabled={!testEmail}>
            Send test
          </button>
        </div>
        {testStatus && <p className="text-sm text-echo-muted">{testStatus}</p>}
      </div>
    </div>
  );
}
