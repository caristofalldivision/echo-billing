"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/supabase/types";

const STATUS_STYLE: Record<Transaction["status"], string> = {
  completed: "bg-echo-mint-100 text-echo-mint-500",
  pending: "bg-echo-amber-100 text-echo-amber-600",
  failed: "bg-echo-coral-100 text-echo-coral-500",
  cancelled: "bg-echo-indigo-100 text-echo-indigo-600",
};

export default function TransactionsPage() {
  const supabase = createClient();
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setTransactions(data ?? []);
    }
    load();

    const channel = supabase
      .channel("transactions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-echo-ink">Payments</h1>
        <p className="text-sm text-echo-muted">Every Pesapal order — STK push, card, or manual.</p>
      </div>

      <div className="card">
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <img src="/doodle-empty.svg" alt="" className="h-32 w-32" />
            <p className="text-sm text-echo-muted">No payments yet.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-echo-muted">
              <tr>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-t border-echo-indigo-50">
                  <td className="py-2 pr-4 font-mono text-xs">{t.pesapal_merchant_reference}</td>
                  <td className="py-2 pr-4">{t.phone ?? "—"}</td>
                  <td className="py-2 pr-4 font-medium">
                    {t.currency} {t.amount}
                  </td>
                  <td className="py-2 pr-4 text-echo-muted">{t.method}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  </td>
                  <td className="py-2 pr-4 text-echo-muted">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
