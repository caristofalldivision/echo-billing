"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

const STATUS_STYLE: Record<Transaction["status"], string> = {
  completed: "bg-signal-pulse-soft text-signal-pulse",
  pending: "bg-signal-voucher-soft text-signal-voucher",
  failed: "bg-signal-alert-soft text-signal-alert",
  cancelled: "bg-signal-ink-faint/15 text-signal-ink-dim",
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
        <h1 className="text-2xl font-bold text-signal-ink">Payments</h1>
        <p className="text-sm text-signal-ink-dim">Every Pesapal order — STK push, card, or manual.</p>
      </div>

      <div className="card">
        {transactions.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <rect x="2.5" y="5" width="19" height="14" rx="2" />
                <path d="M2.5 10h19" />
              </svg>
            }
            message="No payments yet."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
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
                <tr key={t.id} className="border-t border-signal-border">
                  <td className="py-2 pr-4 font-mono text-xs text-signal-ink-dim">{t.pesapal_merchant_reference}</td>
                  <td className="py-2 pr-4">{t.phone ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono font-medium tabular-nums text-signal-ink">
                    {t.currency} {t.amount}
                  </td>
                  <td className="py-2 pr-4 text-signal-ink-dim">{t.method}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
