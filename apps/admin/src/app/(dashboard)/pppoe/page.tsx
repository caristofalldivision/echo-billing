"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Plan, PppoeAccount } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

type AccountRow = PppoeAccount & {
  customers: { full_name: string | null; phone: string } | null;
  plans: { name: string } | null;
};

const STATUS_STYLE: Record<PppoeAccount["status"], string> = {
  active: "bg-signal-pulse-soft text-signal-pulse",
  suspended: "bg-signal-voucher-soft text-signal-voucher",
  expired: "bg-signal-alert-soft text-signal-alert",
};

export default function PppoePage() {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [planId, setPlanId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase
        .from("pppoe_accounts")
        .select("*, customers(full_name, phone), plans(name)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("plans").select("*").eq("type", "pppoe").eq("is_active", true),
    ]);
    setAccounts((a ?? []) as unknown as AccountRow[]);
    setPlans(p ?? []);
    if (p && p.length > 0 && !planId) setPlanId(p[0].id);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function generatePassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setPassword(out);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!planId) {
      setCreateError("Add a PPPoE plan first (Plans page).");
      return;
    }
    setCreating(true);
    const { error } = await supabase.rpc("create_pppoe_account", {
      p_customer_phone: phone,
      p_customer_name: name || null,
      p_username: username,
      p_password: password,
      p_plan_id: planId,
    });
    setCreating(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    setShowForm(false);
    setPhone("");
    setName("");
    setUsername("");
    setPassword("");
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-signal-ink">PPPoE accounts</h1>
          <p className="text-sm text-signal-ink-dim">Fixed-line customers, authenticated via RADIUS same as vouchers.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New account"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Customer phone</label>
              <input className="input" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Customer name (optional)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">PPPoE username</label>
              <input className="input" required value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">PPPoE password</label>
              <div className="flex gap-2">
                <input className="input" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="btn-secondary shrink-0" onClick={generatePassword}>
                  Generate
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Plan</label>
              <select className="input" required value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {plans.length === 0 && <option value="">No PPPoE plans yet</option>}
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.currency} {p.price}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {createError && <p className="text-sm text-signal-alert">{createError}</p>}
          <button type="submit" className="btn-primary self-start" disabled={creating}>
            {creating ? "Creating…" : "Create account"}
          </button>
          <p className="text-xs text-signal-ink-dim">
            Set this password on the customer&apos;s PPPoE dialer too — it&apos;s the same credential RADIUS checks
            when they connect. Copy it now; it isn&apos;t stored anywhere you can read back later.
          </p>
        </form>
      )}

      <div className="card">
        {accounts.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <rect x="3" y="6" width="18" height="12" rx="2" />
                <path d="M7 10h10M7 14h6" />
              </svg>
            }
            message="No PPPoE accounts yet — create the first one above."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
              <tr>
                <th className="py-2 pr-4">Username</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Expires</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-signal-border">
                  <td className="py-2 pr-4 font-mono text-signal-ink">{a.username}</td>
                  <td className="py-2 pr-4 text-signal-ink-dim">
                    {a.customers?.full_name ?? a.customers?.phone ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-signal-ink-dim">{a.plans?.name ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                    {a.expires_at ? new Date(a.expires_at).toLocaleDateString() : "—"}
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
