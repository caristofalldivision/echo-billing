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
    speedDownKbps: "",
    speedUpKbps: "",
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
      speed_down_kbps: form.speedDownKbps ? Number(form.speedDownKbps) : null,
      speed_up_kbps: form.speedUpKbps ? Number(form.speedUpKbps) : null,
      is_active: true,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ ...form, name: "", price: "", durationMinutes: "", dataCapMb: "", speedDownKbps: "", speedUpKbps: "" });
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
          <h1 className="font-display text-2xl font-bold text-echo-ink">Plans</h1>
          <p className="text-sm text-echo-muted">Hotspot passes and PPPoE packages customers can buy.</p>
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
              <label className="mb-1 block text-sm font-medium">Down (Kbps)</label>
              <input
                className="input"
                type="number"
                value={form.speedDownKbps}
                onChange={(e) => setForm({ ...form, speedDownKbps: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Up (Kbps)</label>
              <input
                className="input"
                type="number"
                value={form.speedUpKbps}
                onChange={(e) => setForm({ ...form, speedUpKbps: e.target.value })}
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
              <span className="badge bg-echo-indigo-100 text-echo-indigo-700">{plan.type}</span>
              <button
                className={`badge ${plan.is_active ? "bg-echo-mint-100 text-echo-mint-500" : "bg-echo-coral-100 text-echo-coral-500"}`}
                onClick={() => toggleActive(plan)}
              >
                {plan.is_active ? "Active" : "Disabled"}
              </button>
            </div>
            <h3 className="font-display text-lg font-bold">{plan.name}</h3>
            <p className="font-display text-2xl font-bold text-echo-indigo-500">
              {plan.currency} {plan.price}
            </p>
            <div className="text-sm text-echo-muted">
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
