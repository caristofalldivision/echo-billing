"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PppoeAccount, Voucher } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / 1_000_000;
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1000).toFixed(2)} GB`;
}

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pppoeByCustomer, setPppoeByCustomer] = useState<Record<string, PppoeAccount>>({});
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [usageByUsername, setUsageByUsername] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: p }, { data: v }, { data: live }, { data: history }] = await Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("pppoe_accounts").select("*"),
        supabase.from("vouchers").select("*").not("redeemed_by_customer_id", "is", null),
        supabase.from("active_sessions").select("username, bytes_in, bytes_out"),
        supabase
          .from("session_history")
          .select("username, bytes_in, bytes_out")
          .order("session_end", { ascending: false })
          .limit(5000),
      ]);
      setCustomers(c ?? []);
      setVouchers(v ?? []);
      const map: Record<string, PppoeAccount> = {};
      (p ?? []).forEach((a) => {
        if (a.customer_id) map[a.customer_id] = a;
      });
      setPppoeByCustomer(map);

      // Data used per "user" is only ever knowable per username (a voucher
      // code or PPPoE login) — active_sessions has live totals, session_history
      // has what's accumulated since a session actually ended (see
      // radius-service/src/db.js's deleteActiveSession). Combine both, then
      // resolve username -> customer below via redeemed vouchers / PPPoE
      // account ownership.
      const usage: Record<string, number> = {};
      for (const row of [...(live ?? []), ...(history ?? [])] as {
        username: string;
        bytes_in: number;
        bytes_out: number;
      }[]) {
        usage[row.username] = (usage[row.username] ?? 0) + Number(row.bytes_in) + Number(row.bytes_out);
      }
      setUsageByUsername(usage);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vouchersByCustomer = useMemo(() => {
    const map: Record<string, Voucher[]> = {};
    for (const v of vouchers) {
      if (!v.redeemed_by_customer_id) continue;
      (map[v.redeemed_by_customer_id] ??= []).push(v);
    }
    return map;
  }, [vouchers]);

  function dataUsedFor(customerId: string) {
    const account = pppoeByCustomer[customerId];
    let total = account ? (usageByUsername[account.username] ?? 0) : 0;
    for (const v of vouchersByCustomer[customerId] ?? []) {
      total += usageByUsername[v.code] ?? 0;
    }
    return total;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Customers</h1>
        <p className="text-sm text-signal-ink-dim">Everyone who has paid through Echo, hotspot and PPPoE.</p>
      </div>

      <div className="card">
        {customers.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <circle cx="9" cy="8" r="3.25" />
                <path d="M3.5 19c1-3.2 3.3-4.8 5.5-4.8s4.5 1.6 5.5 4.8" />
              </svg>
            }
            message="No customers yet."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">PPPoE status</th>
                <th className="py-2 pr-4">Data used</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const account = pppoeByCustomer[c.id];
                return (
                  <tr key={c.id} className="border-t border-signal-border">
                    <td className="py-2 pr-4 font-medium text-signal-ink">{c.full_name ?? "—"}</td>
                    <td className="py-2 pr-4">{c.phone}</td>
                    <td className="py-2 pr-4 text-signal-ink-dim">{c.email ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className="badge bg-signal-brand-soft text-signal-brand">{c.type}</span>
                    </td>
                    <td className="py-2 pr-4 text-signal-ink-dim">
                      {account ? `${account.status} · expires ${account.expires_at ? new Date(account.expires_at).toLocaleDateString() : "—"}` : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {formatBytes(dataUsedFor(c.id))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
