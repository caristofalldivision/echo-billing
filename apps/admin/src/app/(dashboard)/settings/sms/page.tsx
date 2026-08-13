"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SmsSettingsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [senderId, setSenderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("*").single();
      if (data) {
        setOrgId(data.id);
        setApiKey(data.talksasa_api_key ?? "");
        setSenderId(data.talksasa_sender_id ?? "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase
      .from("organizations")
      .update({ talksasa_api_key: apiKey, talksasa_sender_id: senderId })
      .eq("id", orgId);
    setSaving(false);
  }

  async function handleTest() {
    setTestStatus("Sending…");
    const { error } = await supabase.functions.invoke("sms-send", {
      body: { to: testPhone, message: "This is a test message from Echo billing.", template: "test" },
    });
    setTestStatus(error ? `Failed: ${error.message}` : "Sent ✓");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-echo-ink">SMS — TalkSasa</h1>
        <p className="text-sm text-echo-muted">Voucher codes, payment receipts, and expiry reminders.</p>
      </div>

      <form onSubmit={handleSave} className="card flex max-w-lg flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">API key</label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Sender ID</label>
          <input className="input" value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="ECHO" />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div className="card flex max-w-lg flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Send a test message</h2>
        <div className="flex gap-3">
          <input
            className="input"
            placeholder="2547XXXXXXXX"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <button className="btn-secondary shrink-0" onClick={handleTest} disabled={!testPhone}>
            Send test
          </button>
        </div>
        {testStatus && <p className="text-sm text-echo-muted">{testStatus}</p>}
      </div>
    </div>
  );
}
