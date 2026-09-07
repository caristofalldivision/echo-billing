"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

const STATUS_STYLE: Record<Transaction["status"], string> = {
  completed: "bg-signal-pulse-soft text-signal-pulse",
  pending: "bg-signal-voucher-soft text-signal-voucher",
  failed: "bg-signal-alert-soft text-signal-alert",
  cancelled: "bg-signal-ink-faint/15 text-signal-ink-dim",
  refunded: "bg-signal-ink-faint/15 text-signal-ink-dim",
};

function toCsv(rows: Transaction[]) {
  const header = ["Reference", "Phone", "Amount", "Currency", "Method", "Status", "Refunded", "Date"];
  const lines = rows.map((t) =>
    [
      t.pesapal_merchant_reference,
      t.phone ?? "",
      t.amount,
      t.currency,
      t.method,
      t.status,
      t.refunded_amount ?? "",
      new Date(t.created_at).toISOString(),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export default function TransactionsPage() {
  const supabase = createClient();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | Transaction["status"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refundFor, setRefundFor] = useState<Transaction | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);

  const [compensateFor, setCompensateFor] = useState<Transaction | null>(null);
  const [compensateReason, setCompensateReason] = useState("");
  const [compensateError, setCompensateError] = useState<string | null>(null);
  const [compensating, setCompensating] = useState(false);
  const [compensateResult, setCompensateResult] = useState<{ code: string; phone: string | null } | null>(null);
  const [compensateSmsStatus, setCompensateSmsStatus] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setTransactions(data ?? []);
  }

  useEffect(() => {
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

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (from && new Date(t.created_at) < new Date(from)) return false;
      if (to && new Date(t.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [transactions, statusFilter, from, to]);

  function openRefund(t: Transaction) {
    setRefundFor(t);
    setRefundAmount(String(t.amount));
    setRefundReason("");
    setRefundError(null);
  }

  async function submitRefund() {
    if (!refundFor) return;
    setRefunding(true);
    setRefundError(null);
    const { error } = await supabase.rpc("refund_transaction", {
      p_transaction_id: refundFor.id,
      p_amount: Number(refundAmount),
      p_reason: refundReason || null,
    });
    setRefunding(false);
    if (error) {
      setRefundError(error.message);
      return;
    }
    setRefundFor(null);
    load();
  }

  function openCompensate(t: Transaction) {
    setCompensateFor(t);
    setCompensateReason("");
    setCompensateError(null);
    setCompensateResult(null);
    setCompensateSmsStatus(null);
  }

  async function submitCompensate() {
    if (!compensateFor) return;
    setCompensating(true);
    setCompensateError(null);
    const { data, error } = await supabase.rpc("compensate_transaction_with_voucher", {
      p_transaction_id: compensateFor.id,
      p_reason: compensateReason || null,
    });
    setCompensating(false);
    if (error) {
      setCompensateError(error.message);
      return;
    }
    setCompensateResult({ code: data.code, phone: compensateFor.phone });
    load();
  }

  async function sendCompensationSms() {
    if (!compensateResult?.phone) return;
    setCompensateSmsStatus("Sending…");
    const { error } = await supabase.functions.invoke("sms-send", {
      body: {
        to: compensateResult.phone,
        message: `Echo: Here's a free WiFi code as an apology — ${compensateResult.code}.`,
        template: "compensation",
      },
    });
    setCompensateSmsStatus(error ? `Failed: ${error.message}` : "Sent ✓");
  }

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `echo-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-signal-ink">Payments</h1>
          <p className="text-sm text-signal-ink-dim">Every Pesapal order — STK push, card, or manual.</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">To</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(statusFilter !== "all" || from || to) && (
          <button
            className="text-xs font-bold text-signal-ink-dim"
            onClick={() => {
              setStatusFilter("all");
              setFrom("");
              setTo("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <rect x="2.5" y="5" width="19" height="14" rx="2" />
                <path d="M2.5 10h19" />
              </svg>
            }
            message="No payments match these filters."
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
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-t border-signal-border">
                  <td className="py-2 pr-4 font-mono text-xs text-signal-ink-dim">{t.pesapal_merchant_reference}</td>
                  <td className="py-2 pr-4">{t.phone ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono font-medium tabular-nums text-signal-ink">
                    {t.currency} {t.amount}
                    {t.status === "refunded" && (
                      <span className="ml-1 text-xs text-signal-alert">(-{t.refunded_amount})</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-signal-ink-dim">{t.method}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4">
                    {t.status === "completed" && (
                      <span className="flex gap-3">
                        <button className="text-xs font-bold text-signal-brand" onClick={() => openCompensate(t)}>
                          Compensate
                        </button>
                        <button className="text-xs font-bold text-signal-alert" onClick={() => openRefund(t)}>
                          Refund
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {refundFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm border-2 border-signal-border bg-signal-surface-solid p-5">
            <h2 className="mb-1 text-lg font-bold text-signal-ink">Refund payment</h2>
            <p className="mb-4 text-xs text-signal-ink-dim">{refundFor.pesapal_merchant_reference}</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">
                  Amount ({refundFor.currency}, max {refundFor.amount})
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={refundFor.amount}
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">Reason (optional)</label>
                <input className="input" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Customer requested…" />
              </div>
              {refundError && <p className="text-sm text-signal-alert">{refundError}</p>}
              <div className="mt-1 flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setRefundFor(null)} disabled={refunding}>
                  Cancel
                </button>
                <button className="btn-primary bg-signal-alert" onClick={submitRefund} disabled={refunding}>
                  {refunding ? "Refunding…" : "Confirm refund"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {compensateFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm border-2 border-signal-border bg-signal-surface-solid p-5">
            {compensateResult ? (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-bold text-signal-ink">Voucher issued</h2>
                <p className="border-2 border-signal-border bg-signal-bg-elevated px-3 py-2 text-center font-mono text-lg font-bold text-signal-ink">
                  {compensateResult.code}
                </p>
                {compensateResult.phone ? (
                  <>
                    <button className="btn-primary self-start" onClick={sendCompensationSms} disabled={compensateSmsStatus === "Sending…"}>
                      Text this code to {compensateResult.phone}
                    </button>
                    {compensateSmsStatus && (
                      <p className={`text-sm ${compensateSmsStatus.startsWith("Failed") ? "text-signal-alert" : "text-signal-pulse"}`}>
                        {compensateSmsStatus}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-signal-ink-dim">No phone on file — relay this code to the customer manually.</p>
                )}
                <button className="btn-secondary self-start" onClick={() => setCompensateFor(null)}>
                  Done
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="mb-1 text-lg font-bold text-signal-ink">Compensate with a voucher</h2>
                <p className="text-xs text-signal-ink-dim">
                  {compensateFor.pesapal_merchant_reference} — issues a free voucher for the same plan without
                  touching the payment record. Use this instead of a cash refund when the customer paid fine but
                  something on our end (connection, provisioning) failed them.
                </p>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">Reason (optional)</label>
                  <input
                    className="input"
                    value={compensateReason}
                    onChange={(e) => setCompensateReason(e.target.value)}
                    placeholder="Didn't connect after payment…"
                  />
                </div>
                {compensateError && <p className="text-sm text-signal-alert">{compensateError}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button className="btn-secondary" onClick={() => setCompensateFor(null)} disabled={compensating}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={submitCompensate} disabled={compensating}>
                    {compensating ? "Issuing…" : "Issue voucher"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
