"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer, PppoeAccount } from "@/lib/supabase/types";

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
        <h1 className="font-display text-2xl font-bold text-echo-ink">Customers</h1>
        <p className="text-sm text-echo-muted">Everyone who has paid through Echo, hotspot and PPPoE.</p>
      </div>

      <div className="card">
        {customers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <img src="/doodle-empty.svg" alt="" className="h-32 w-32" />
            <p className="text-sm text-echo-muted">No customers yet.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-echo-muted">
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
                  <tr key={c.id} className="border-t border-echo-indigo-50">
                    <td className="py-2 pr-4 font-medium">{c.full_name ?? "—"}</td>
                    <td className="py-2 pr-4">{c.phone}</td>
                    <td className="py-2 pr-4 text-echo-muted">{c.email ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className="badge bg-echo-indigo-100 text-echo-indigo-700">{c.type}</span>
                    </td>
                    <td className="py-2 pr-4 text-echo-muted">
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
