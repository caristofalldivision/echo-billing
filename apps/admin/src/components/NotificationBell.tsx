"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/supabase/types";

const SEVERITY_DOT: Record<Notification["severity"], string> = {
  info: "bg-signal-brand",
  warning: "bg-signal-voucher",
  critical: "bg-signal-alert",
};

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const supabase = createClient();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    setItems(data ?? []);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = items.filter((n) => !n.read_at).length;

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    load();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center border-2 border-signal-border text-signal-ink transition hover:bg-signal-brand-soft"
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center border border-signal-bg bg-signal-alert px-0.5 font-mono text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 border-2 border-signal-border bg-signal-surface-solid">
          <div className="flex items-center justify-between border-b-2 border-signal-border px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-signal-ink-faint">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-bold text-signal-brand">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-signal-ink-dim">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`flex gap-2 border-b border-signal-border px-3 py-2.5 ${!n.read_at ? "bg-signal-brand-soft/40" : ""}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 ${SEVERITY_DOT[n.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-signal-ink">{n.title}</p>
                    {n.body && <p className="truncate text-xs text-signal-ink-dim">{n.body}</p>}
                    <p className="font-mono text-[10px] text-signal-ink-faint">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t-2 border-signal-border px-3 py-2 text-center text-xs font-bold text-signal-brand hover:bg-signal-brand-soft"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
