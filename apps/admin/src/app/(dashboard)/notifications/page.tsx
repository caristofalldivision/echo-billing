"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

const SEVERITY_STYLE: Record<Notification["severity"], string> = {
  info: "bg-signal-pulse-soft text-signal-pulse",
  warning: "bg-signal-voucher-soft text-signal-voucher",
  critical: "bg-signal-alert-soft text-signal-alert",
};

const TYPE_LABEL: Record<Notification["type"], string> = {
  payment_completed: "Payment",
  payment_failed: "Payment",
  payment_refunded: "Refund",
  device_linked: "Device",
  device_offline: "Device",
  device_error: "Device",
  voucher_low: "Vouchers",
};

export default function NotificationsPage() {
  const supabase = createClient();
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setItems(data ?? []);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("notifications-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    load();
  }

  const filtered = items.filter((n) => filter === "all" || !n.read_at);
  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-signal-ink">Notifications</h1>
          <p className="text-sm text-signal-ink-dim">Payments, refunds, and device status changes.</p>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="btn-secondary" onClick={markAllRead}>
            Mark all read ({unreadCount})
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`badge cursor-pointer ${filter === f ? "bg-signal-brand text-white" : "bg-signal-bg-elevated text-signal-ink-dim"}`}
          >
            {f === "all" ? "All" : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      <div className="card !p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
                <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
              </svg>
            }
            message={filter === "unread" ? "No unread notifications." : "No notifications yet."}
          />
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between gap-4 border-b border-signal-border px-5 py-4 last:border-b-0 ${
                !n.read_at ? "bg-signal-brand-soft/30" : ""
              }`}
            >
              <div className="flex min-w-0 flex-1 gap-3">
                <span className={`badge shrink-0 ${SEVERITY_STYLE[n.severity]}`}>{TYPE_LABEL[n.type]}</span>
                <div className="min-w-0">
                  <p className="font-bold text-signal-ink">{n.title}</p>
                  {n.body && <p className="text-sm text-signal-ink-dim">{n.body}</p>}
                  <p className="mt-1 font-mono text-xs text-signal-ink-faint">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              {!n.read_at && (
                <button
                  type="button"
                  className="shrink-0 text-xs font-bold text-signal-brand"
                  onClick={() => markRead(n.id)}
                >
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
