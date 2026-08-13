"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Plan, Voucher } from "@/lib/supabase/types";

export default function VouchersPage() {
  const supabase = createClient();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");

  async function load() {
    const [{ data: v }, { data: p }] = await Promise.all([
      supabase.from("vouchers").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("plans").select("*").eq("type", "hotspot").eq("is_active", true),
    ]);
    setVouchers(v ?? []);
    setPlans(p ?? []);
    if (p && p.length > 0 && !planId) setPlanId(p[0].id);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setGenerating(true);
    const { error } = await supabase.functions.invoke("voucher-generate", {
      body: { planId, quantity },
    });
    setGenerating(false);
    if (!error) load();
  }

  const filtered = vouchers.filter((v) => filter === "all" || v.status === filter);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-echo-ink">Vouchers</h1>
        <p className="text-sm text-echo-muted">Generate printable hotspot access codes in batches.</p>
      </div>

      <form onSubmit={handleGenerate} className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Plan</label>
          <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.currency} {p.price}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Quantity</label>
          <input
            className="input w-28"
            type="number"
            min={1}
            max={1000}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={generating || !planId}>
          {generating ? "Generating…" : "Generate batch"}
        </button>
      </form>

      <div className="flex gap-2">
        {(["all", "unused", "used"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`badge ${filter === f ? "bg-echo-indigo-500 text-white" : "bg-echo-indigo-50 text-echo-indigo-600"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <img src="/doodle-voucher.svg" alt="" className="h-28 w-40" />
            <p className="text-sm text-echo-muted">No vouchers yet — generate your first batch above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {filtered.map((v) => (
              <div
                key={v.id}
                className="rounded-xl border border-dashed border-echo-amber-500/60 bg-echo-amber-100/40 px-3 py-2 text-center"
              >
                <div className="font-mono text-sm font-bold tracking-wide">{v.code}</div>
                <div
                  className={`mt-1 text-xs font-medium ${v.status === "unused" ? "text-echo-mint-500" : "text-echo-muted"}`}
                >
                  {v.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
