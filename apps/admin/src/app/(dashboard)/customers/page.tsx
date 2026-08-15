"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PppoeAccount } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pppoeByCustomer, setPppoeByCustomer] = useState<Record<string, PppoeAccount>>({});

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("pppoe_accounts").select("*"),
      ]);
      setCustomers(c ?? []);
      const map: Record<string, PppoeAccount> = {};
      (p ?? []).forEach((a) => {
        if (a.customer_id) map[a.customer_id] = a;
      });
      setPppoeByCustomer(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
