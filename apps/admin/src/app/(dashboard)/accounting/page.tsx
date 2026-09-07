"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatTile } from "@/components/StatTile";
import { RevenueBarChart, type RevenuePoint } from "@/components/charts/RevenueBarChart";
import { HorizontalBarList } from "@/components/charts/HorizontalBarList";

interface Row {
  amount: number;
  currency: string;
  method: string;
  status: string;
  refunded_amount: number | null;
  created_at: string;
  completed_at: string | null;
  plans: { name: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function AccountingPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [currency, setCurrency] = useState("KES");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
      const { data } = await supabase
        .from("transactions")
        .select("amount, currency, method, status, refunded_amount, created_at, completed_at, plans(name)")
        .in("status", ["completed", "refunded"])
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      const typed = (data ?? []) as unknown as Row[];
      setRows(typed);
      if (typed[0]) setCurrency(typed[0].currency);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel("accounting-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalRevenue = 0;
    let monthRevenue = 0;
    let todayRevenue = 0;
    let totalRefunded = 0;

    for (const r of rows) {
      const completedAt = r.completed_at ? new Date(r.completed_at) : null;
      const grossAmount = Number(r.amount);
      const refunded = Number(r.refunded_amount ?? 0);

      if (r.status === "completed" || r.status === "refunded") {
        totalRevenue += grossAmount;
        if (completedAt && completedAt >= monthStart) monthRevenue += grossAmount;
        if (completedAt && completedAt >= todayStart) todayRevenue += grossAmount;
      }
      if (r.status === "refunded") totalRefunded += refunded || grossAmount;
    }

    return {
      totalRevenue,
      monthRevenue,
      todayRevenue,
      totalRefunded,
      netRevenue: totalRevenue - totalRefunded,
    };
  }, [rows]);

  const dailySeries: RevenuePoint[] = useMemo(() => {
    const days = 30;
    const buckets = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = startOfDay(new Date(Date.now() - i * DAY_MS));
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      if (r.status !== "completed" && r.status !== "refunded") continue;
      const at = r.completed_at ?? r.created_at;
      const key = startOfDay(new Date(at)).toISOString().slice(0, 10);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + Number(r.amount) - Number(r.refunded_amount ?? 0));
      }
    }
    return Array.from(buckets.entries()).map(([key, value]) => {
      const d = new Date(key);
      return {
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        fullLabel: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        value,
      };
    });
  }, [rows]);

  const byPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "completed" && r.status !== "refunded") continue;
      const name = r.plans?.name ?? "Unknown plan";
      map.set(name, (map.get(name) ?? 0) + Number(r.amount) - Number(r.refunded_amount ?? 0));
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [rows]);

  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "completed" && r.status !== "refunded") continue;
      const label = { mpesa_stk: "M-Pesa", card: "Card", manual: "Manual" }[r.method] ?? r.method;
      map.set(label, (map.get(label) ?? 0) + Number(r.amount) - Number(r.refunded_amount ?? 0));
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Accounting</h1>
        <p className="text-sm text-signal-ink-dim">Revenue, refunds, and where it&apos;s coming from — to the last cent.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile label="Today" value={`${currency} ${stats.todayRevenue.toLocaleString()}`} accent="pulse" />
        <StatTile label="This month" value={`${currency} ${stats.monthRevenue.toLocaleString()}`} accent="brand" />
        <StatTile label="Total (90d)" value={`${currency} ${stats.totalRevenue.toLocaleString()}`} accent="brand" />
        <StatTile label="Refunded" value={`${currency} ${stats.totalRefunded.toLocaleString()}`} accent="alert" />
        <StatTile label="Net" value={`${currency} ${stats.netRevenue.toLocaleString()}`} accent="voucher" />
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-bold text-signal-ink">Revenue — last 30 days</h2>
        {loading ? (
          <p className="text-sm text-signal-ink-dim">Loading…</p>
        ) : (
          <RevenueBarChart data={dailySeries} currency={currency} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-lg font-bold text-signal-ink">Revenue by plan</h2>
          <HorizontalBarList items={byPlan} currency={currency} />
        </div>
        <div className="card">
          <h2 className="mb-4 text-lg font-bold text-signal-ink">Revenue by payment method</h2>
          <HorizontalBarList items={byMethod} currency={currency} />
        </div>
      </div>

      <a href="/transactions" className="self-start text-sm font-bold text-signal-brand hover:underline">
        View the full transaction ledger →
      </a>
    </div>
  );
}
