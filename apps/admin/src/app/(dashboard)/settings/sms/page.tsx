"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SmsLog } from "@/lib/supabase/types";

const STATUS_STYLE: Record<SmsLog["status"], string> = {
  sent: "bg-signal-pulse-soft text-signal-pulse",
  queued: "bg-signal-voucher-soft text-signal-voucher",
  failed: "bg-signal-alert-soft text-signal-alert",
};

export default function SmsSettingsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [senderId, setSenderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  const [logs, setLogs] = useState<SmsLog[]>([]);

  async function loadLogs() {
    const { data } = await supabase
      .from("sms_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setLogs(data ?? []);
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("*").single();
      if (data) {
        setOrgId(data.id);
        setApiKey(data.talksasa_api_key ?? "");
        setSenderId(data.talksasa_sender_id ?? "");
      }
    })();
    loadLogs();

    const channel = supabase
      .channel("sms-logs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_logs" }, loadLogs)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendStatus(null);
    const { error } = await supabase.functions.invoke("sms-send", {
      body: { to: sendTo, message: sendMessage, template: "manual" },
    });
    setSending(false);
    if (error) {
      setSendStatus(`Failed: ${error.message}`);
      return;
    }
    setSendStatus("Sent ✓");
    setSendMessage("");
    loadLogs();
    setTimeout(() => setSendStatus(null), 3000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">SMS — TalkSasa</h1>
        <p className="text-sm text-signal-ink-dim">Voucher codes, payment receipts, and one-off messages.</p>
      </div>

      <form onSubmit={handleSave} className="card flex max-w-lg flex-col gap-4">
        <h2 className="text-lg font-bold text-signal-ink">Credentials</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">API key</label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Sender ID</label>
          <input className="input" value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="ECHO" />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </form>

      <form onSubmit={handleSend} className="card flex max-w-lg flex-col gap-3">
        <h2 className="text-lg font-bold text-signal-ink">Send a message</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">To</label>
          <input
            className="input"
            required
            placeholder="07XXXXXXXX or 254XXXXXXXXX"
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Message</label>
          <textarea
            className="input h-24 resize-none"
            required
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            placeholder="Type a message…"
          />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={sending || !sendTo || !sendMessage}>
          {sending ? "Sending…" : "Send"}
        </button>
        {sendStatus && (
          <p className={`text-sm ${sendStatus.startsWith("Failed") ? "text-signal-alert" : "text-signal-pulse"}`}>
            {sendStatus}
          </p>
        )}
      </form>

      <div className="card">
        <h2 className="mb-4 text-lg font-bold text-signal-ink">History</h2>
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-signal-ink-dim">No messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
                <tr>
                  <th className="py-2 pr-4">To</th>
                  <th className="py-2 pr-4">Message</th>
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Date</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-signal-border">
                    <td className="py-2 pr-4 font-mono text-signal-ink">{l.recipient_phone}</td>
                    <td className="max-w-xs truncate py-2 pr-4 text-signal-ink-dim" title={l.message}>
                      {l.message}
                    </td>
                    <td className="py-2 pr-4 text-signal-ink-dim">{l.template ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`badge ${STATUS_STYLE[l.status]}`}>{l.status}</span>
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
