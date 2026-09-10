"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ActiveSession, SessionHistory } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

// Live and finished sessions in one place. Both tables are written by
// radius-service's accounting listener (radius-acct.js): active_sessions on
// Start/Interim, and the row is moved into session_history on Stop. Until
// this page existed, that data had no operator-facing view at all — the only
// way to answer "is this customer actually online right now?" or "did their
// session really end?" was querying Postgres by hand.
type Tab = "active" | "history";

function fmtBytes(n: number) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDuration(startIso: string | null, endIso: string) {
  if (!startIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// A session whose NAS stopped sending accounting updates is almost certainly
// gone (client walked off, router rebooted) even though its row is still in
// active_sessions — RADIUS Stop packets get lost. Flagging it is more honest
// than showing a stale row as definitively "online".
const STALE_AFTER_MS = 15 * 60 * 1000;

export default function SessionsPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("active");
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [history, setHistory] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [a, h] = await Promise.all([
      supabase.from("active_sessions").select("*").order("session_start", { ascending: false }),
      supabase
        .from("session_history")
        .select("*")
        .order("session_end", { ascending: false })
        .limit(200),
    ]);
    setActive(a.data ?? []);
    setHistory(h.data ?? []);
    setLoading(false);
  }

  // Polled rather than pushed: active_sessions changes on RADIUS accounting
  // packets, not on anything a browser can subscribe to meaningfully, and a
  // 20s refresh is well inside the useful resolution for "who's online".
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-signal-ink">Sessions</h1>
          <p className="text-sm text-signal-ink-dim">
            Who is online now, and what has finished. Updates every 20s.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={tab === "active" ? "btn-primary py-1.5" : "btn-secondary py-1.5"}
            onClick={() => setTab("active")}
          >
            Active ({active.length})
          </button>
          <button
            className={tab === "history" ? "btn-primary py-1.5" : "btn-secondary py-1.5"}
            onClick={() => setTab("history")}
          >
            Finished
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-sm text-signal-ink-dim">Loading…</p>
        ) : tab === "active" ? (
          active.length === 0 ? (
            <EmptyState
              icon="📶"
              message="Nobody is online right now. Active sessions appear here as soon as a customer authenticates through the captive portal."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
                <tr>
                  <th className="py-2 pr-4">User / voucher</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">MAC</th>
                  <th className="py-2 pr-4">Online for</th>
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => {
                  const stale = now - new Date(s.last_update_at).getTime() > STALE_AFTER_MS;
                  return (
                    <tr key={s.id} className="border-t border-signal-border">
                      <td className="py-2 pr-4 font-mono font-medium text-signal-ink">{s.username}</td>
                      <td className="py-2 pr-4 text-signal-ink-dim">{s.session_type}</td>
                      <td className="py-2 pr-4 font-mono text-signal-ink-dim">{s.framed_ip ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-signal-ink-dim">
                        {s.mac_address ?? "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-signal-ink-dim">
                        {fmtDuration(s.session_start, new Date().toISOString())}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-signal-ink-dim">
                        ↓ {fmtBytes(s.bytes_out)} · ↑ {fmtBytes(s.bytes_in)}
                      </td>
                      <td className="py-2 pr-4">
                        {stale ? (
                          <span className="badge bg-signal-voucher-soft text-signal-voucher">
                            no updates {fmtDuration(s.last_update_at, new Date().toISOString())}
                          </span>
                        ) : (
                          <span className="badge bg-signal-pulse-soft text-signal-pulse">live</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : history.length === 0 ? (
          <EmptyState
            icon="🗂"
            message="No finished sessions yet. Once a customer disconnects, their session moves here with its final duration and data usage."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
              <tr>
                <th className="py-2 pr-4">User / voucher</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">MAC</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Lasted</th>
                <th className="py-2 pr-4">Data</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-t border-signal-border">
                  <td className="py-2 pr-4 font-mono font-medium text-signal-ink">{s.username}</td>
                  <td className="py-2 pr-4 text-signal-ink-dim">{s.session_type}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-signal-ink-dim">
                    {s.mac_address ?? "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-signal-ink-dim">
                    {s.session_start ? new Date(s.session_start).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-signal-ink-dim">
                    {fmtDuration(s.session_start, s.session_end)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-signal-ink-dim">
                    ↓ {fmtBytes(s.bytes_out)} · ↑ {fmtBytes(s.bytes_in)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
