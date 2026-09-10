"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Plan } from "@/lib/supabase/types";

export default function PlansPage() {
  const supabase = createClient();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: "hotspot",
    name: "",
    price: "",
    durationMinutes: "",
    dataCapMb: "",
    speedDownMbps: "",
    speedUpMbps: "",
  });

  async function load() {
    const { data } = await supabase.from("plans").select("*").order("type").order("price");
    setPlans(data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: org } = await supabase.from("organizations").select("id").single();
    await supabase.from("plans").insert({
      org_id: org!.id,
      type: form.type as "hotspot" | "pppoe",
      name: form.name,
      price: Number(form.price),
      duration_minutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      data_cap_mb: form.dataCapMb ? Number(form.dataCapMb) : null,
      // Collected in Mbps (what an ISP actually sells and what an admin
      // thinks in), stored in kbps because that's what
      // Mikrotik-Rate-Limit wants. The form used to be labelled "Kbps"
      // and a plan was created with 5 — meaning 5 Mbps, stored as 5 kbps
      // — which RADIUS then handed the router as a literal 5k/5k rate
      // limit. Customers authenticated fine and then had a connection so
      // throttled that nothing loaded at all, which is indistinguishable
      // from "connected but no internet" and cost real debugging time
      // (2026-09-10). Doing the unit conversion here, in the one place a
      // human types the number, is what stops that recurring.
      speed_down_kbps: form.speedDownMbps ? Math.round(Number(form.speedDownMbps) * 1000) : null,
      speed_up_kbps: form.speedUpMbps ? Math.round(Number(form.speedUpMbps) * 1000) : null,
      is_active: true,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ ...form, name: "", price: "", durationMinutes: "", dataCapMb: "", speedDownMbps: "", speedUpMbps: "" });
    load();
  }

  async function toggleActive(plan: Plan) {
    await supabase.from("plans").update({ is_active: !plan.is_active }).eq("id", plan.id);
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-signal-ink">Plans</h1>
          <p className="text-sm text-signal-ink-dim">Hotspot passes and PPPoE packages customers can buy.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New plan"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="hotspot">Hotspot</option>
              <option value="pppoe">PPPoE</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 24 Hours"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Price (KES)</label>
            <input
              className="input"
              type="number"
              required
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Duration (minutes)</label>
            <input
              className="input"
              type="number"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              placeholder="leave blank for monthly PPPoE"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Data cap (MB)</label>
            <input
              className="input"
              type="number"
              value={form.dataCapMb}
              onChange={(e) => setForm({ ...form, dataCapMb: e.target.value })}
              placeholder="leave blank for unlimited"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Download (Mbps)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0.1"
                value={form.speedDownMbps}
                onChange={(e) => setForm({ ...form, speedDownMbps: e.target.value })}
                placeholder="e.g. 5 — blank for uncapped"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Upload (Mbps)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0.1"
                value={form.speedUpMbps}
                onChange={(e) => setForm({ ...form, speedUpMbps: e.target.value })}
                placeholder="e.g. 3 — blank for uncapped"
              />
            </div>
          </div>
          <div className="col-span-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create plan"}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="card flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-brand-soft text-signal-brand">{plan.type}</span>
              <button
                className={`badge ${plan.is_active ? "bg-signal-pulse-soft text-signal-pulse" : "bg-signal-alert-soft text-signal-alert"}`}
                onClick={() => toggleActive(plan)}
              >
                {plan.is_active ? "Active" : "Disabled"}
              </button>
            </div>
            <h3 className="text-lg font-bold text-signal-ink">{plan.name}</h3>
            <p className="font-mono text-2xl font-bold tabular-nums text-signal-brand">
              {plan.currency} {plan.price}
            </p>
            <div className="text-sm text-signal-ink-dim">
              {plan.duration_minutes ? `${plan.duration_minutes} min` : "No time limit"}
              {" · "}
              {plan.data_cap_mb ? `${plan.data_cap_mb} MB` : "Unlimited data"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
