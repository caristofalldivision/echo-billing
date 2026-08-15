"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ActiveSession, Transaction } from "@/lib/supabase/types";
import { StatTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";

export default function DashboardPage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [revenueToday, setRevenueToday] = useState(0);
  const [vouchersUnused, setVouchersUnused] = useState(0);
  const [devicesLinked, setDevicesLinked] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [sessionsRes, txRes, vouchersRes, devicesRes] = await Promise.all([
        supabase.from("active_sessions").select("*").order("session_start", { ascending: false }),
        supabase
          .from("transactions")
          .select("amount")
          .eq("status", "completed")
          .gte("completed_at", startOfDay.toISOString()),
        supabase.from("vouchers").select("id", { count: "exact", head: true }).eq("status", "unused"),
        supabase
          .from("mikrotik_devices")
          .select("id", { count: "exact", head: true })
          .eq("status", "linked"),
      ]);

      if (cancelled) return;
      setSessions(sessionsRes.data ?? []);
      setRevenueToday(
        (txRes.data ?? []).reduce((sum: number, t: { amount: number }) => sum + Number(t.amount), 0),
      );
      setVouchersUnused(vouchersRes.count ?? 0);
      setDevicesLinked(devicesRes.count ?? 0);
    }
    load();

    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_sessions" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Dashboard</h1>
        <p className="text-sm text-signal-ink-dim">Live view of your network, right now.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Active sessions" value={sessions.length} accent="pulse" />
        <StatTile label="Revenue today" value={`KES ${revenueToday.toLocaleString()}`} accent="brand" />
        <StatTile label="Unused vouchers" value={vouchersUnused} accent="voucher" />
        <StatTile label="MikroTiks linked" value={devicesLinked} accent="brand" />
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-bold text-signal-ink">Active sessions</h2>
        {sessions.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <path d="M3 12h4l2.5 7L14 4l2 8h5" />
              </svg>
            }
            message="No one's online yet — once a customer connects, they'll show up here live."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
                <tr>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">Since</th>
                  <th className="py-2 pr-4">Data used</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-signal-border">
                    <td className="py-2 pr-4 font-medium text-signal-ink">{s.username}</td>
                    <td className="py-2 pr-4">
                      <span className="badge bg-signal-brand-soft text-signal-brand">
                        {s.session_type}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {s.framed_ip ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {new Date(s.session_start).toLocaleTimeString()}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {(((s.bytes_in ?? 0) + (s.bytes_out ?? 0)) / 1_000_000).toFixed(1)} MB
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
