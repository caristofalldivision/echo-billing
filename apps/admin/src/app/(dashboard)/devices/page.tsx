"use client";

import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/functions";
import type { MikrotikDevice } from "@/lib/supabase/types";

const STATUS_STYLE: Record<MikrotikDevice["status"], string> = {
  linked: "bg-echo-mint-100 text-echo-mint-500",
  pending: "bg-echo-amber-100 text-echo-amber-600",
  offline: "bg-echo-indigo-100 text-echo-indigo-600",
  error: "bg-echo-coral-100 text-echo-coral-500",
};

export default function DevicesPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<MikrotikDevice[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [scriptFor, setScriptFor] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [loadingScript, setLoadingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    const { data, error } = await supabase
      .from("mikrotik_devices")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError("Couldn't load your MikroTiks. Please try again.");
      return;
    }
    setDevices(data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const { data: org, error: orgError } = await supabase.from("organizations").select("id").single();
    if (orgError || !org) {
      setCreateError("Couldn't find your organization. Please refresh and try again.");
      return;
    }
    const { error } = await supabase.from("mikrotik_devices").insert({ org_id: org.id, name, site });
    if (error) {
      setCreateError("Couldn't add that MikroTik. Please try again.");
      return;
    }
    setShowForm(false);
    setName("");
    setSite("");
    load();
  }

  async function handleGenerateScript(deviceId: string, confirmRegenerate = false) {
    setScriptFor(deviceId);
    setLoadingScript(true);
    setScriptError(null);
    setConfirmRegenerateId(null);
    const { data, error } = await supabase.functions.invoke("provisioning-script", {
      body: { mikrotikDeviceId: deviceId, confirmRegenerate },
    });
    setLoadingScript(false);
    if (error) {
      if (error instanceof FunctionsHttpError && error.context.status === 409) {
        setScriptFor(null);
        setConfirmRegenerateId(deviceId);
        return;
      }
      setScriptError(await getFunctionErrorMessage(error, "Couldn't generate the setup script."));
      return;
    }
    setScript(data.script);
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-echo-ink">MikroTiks</h1>
          <p className="text-sm text-echo-muted">Link routers to Echo — one script, run once, fully automated.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add MikroTik"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Street AP" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Site</label>
            <input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. Nairobi CBD" />
          </div>
          <button type="submit" className="btn-primary">Save</button>
          {createError && <p className="w-full text-sm text-echo-coral-500">{createError}</p>}
        </form>
      )}

      <div className="card">
        {loadError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-echo-coral-500">{loadError}</p>
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <img src="/doodle-empty.svg" alt="" className="h-32 w-32" />
            <p className="text-sm text-echo-muted">No routers linked yet — add one to get its provisioning script.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-echo-muted">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Site</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Last seen</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-t border-echo-indigo-50">
                  <td className="py-2 pr-4 font-medium">{d.name}</td>
                  <td className="py-2 pr-4 text-echo-muted">{d.site ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                  </td>
                  <td className="py-2 pr-4 text-echo-muted">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "never"}
                  </td>
                  <td className="py-2 pr-4">
                    {confirmRegenerateId === d.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-echo-coral-500">This will disconnect it.</span>
                        <button
                          className="text-sm font-medium text-echo-coral-500"
                          onClick={() => handleGenerateScript(d.id, true)}
                        >
                          Regenerate anyway
                        </button>
                        <button
                          className="text-sm font-medium text-echo-muted"
                          onClick={() => setConfirmRegenerateId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button className="btn-secondary py-1.5" onClick={() => handleGenerateScript(d.id)}>
                        {d.status === "linked" ? "Regenerate script" : "Get setup script"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scriptError && <p className="text-sm text-echo-coral-500">{scriptError}</p>}

      {scriptFor && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">RouterOS setup script</h2>
            <button className="text-sm text-echo-muted" onClick={() => setScriptFor(null)}>
              Close
            </button>
          </div>
          <p className="mb-3 text-sm text-echo-muted">
            Paste this into a New Terminal on the router (or import as .rsc). It sets up the WireGuard
            tunnel, RADIUS, hotspot/PPPoE profiles, walled garden, and pulls the captive portal — one time, no follow-up needed.
          </p>
          {loadingScript ? (
            <p className="text-sm text-echo-muted">Generating…</p>
          ) : (
            <textarea
              readOnly
              className="input h-80 font-mono text-xs"
              value={script}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </div>
      )}
    </div>
  );
}
