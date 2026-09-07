"use client";

import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/functions";
import type { MikrotikDevice } from "@/lib/supabase/types";
import { EmptyState } from "@/components/EmptyState";

const STATUS_STYLE: Record<MikrotikDevice["status"], string> = {
  linked: "bg-signal-pulse-soft text-signal-pulse",
  pending: "bg-signal-voucher-soft text-signal-voucher",
  offline: "bg-signal-ink-faint/15 text-signal-ink-dim",
  error: "bg-signal-alert-soft text-signal-alert",
};

export default function DevicesPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<MikrotikDevice[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [scriptFor, setScriptFor] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [bootstrap, setBootstrap] = useState("");
  const [showFullScript, setShowFullScript] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bootstrapCopied, setBootstrapCopied] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  async function copyBootstrap() {
    await navigator.clipboard.writeText(bootstrap);
    setBootstrapCopied(true);
    setWaitingSince(Date.now());
    setTimeout(() => setBootstrapCopied(false), 2000);
  }

  // Once the admin copies the bootstrap, poll the device's own row so the
  // panel can show it flipping from "pending" to "linked" live instead of
  // leaving them staring at a static script with no feedback — the router's
  // first heartbeat (fires right after provisioning, then every 5m) is what
  // actually flips this.
  useEffect(() => {
    if (!waitingSince || !scriptFor) return;
    const device = devices.find((d) => d.id === scriptFor);
    if (device?.status === "linked") return;

    const poll = setInterval(load, 4000);
    const tick = setInterval(() => setElapsedSec(Math.floor((Date.now() - waitingSince) / 1000)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingSince, scriptFor, devices.find((d) => d.id === scriptFor)?.status]);

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
    setBootstrap(data.bootstrap ?? "");
    setShowFullScript(false);
    setWaitingSince(null);
    setElapsedSec(0);
    load();
  }

  // Re-shows the current bootstrap for an already-provisioned device
  // without rotating its WireGuard credentials (which would disconnect
  // it) — provisioning-fetch is a public GET keyed off the device's own
  // provisioning_token, which the admin already has in hand.
  //
  // NOTE: this string must stay identical to renderBootstrapScript() in
  // supabase/functions/_shared/router-template.ts — there's no server
  // round-trip cheap enough to justify for a 5-line snippet, but that
  // means changes to one must be copied to the other by hand.
  function handleShowBootstrap(device: MikrotikDevice) {
    setScriptFor(device.id);
    setScriptError(null);
    setShowFullScript(false);
    setScript("");
    setWaitingSince(null);
    setElapsedSec(0);
    setBootstrap(
      `/system ntp client set enabled=yes\n:if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }\n:delay 5s\n/tool fetch url="${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/provisioning-fetch?token=${device.provisioning_token}" dst-path="echo-setup.rsc" mode=https\n/import file-name=echo-setup.rsc\n`,
    );
  }

  async function loadFullScript(device: MikrotikDevice) {
    setLoadingScript(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/provisioning-fetch?token=${device.provisioning_token}`,
      );
      setScript(await res.text());
    } catch {
      setScriptError("Couldn't load the full script. Please try again.");
    }
    setLoadingScript(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-signal-ink">MikroTiks</h1>
          <p className="text-sm text-signal-ink-dim">Link routers to Echo — one script, run once, fully automated.</p>
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
          {createError && <p className="w-full text-sm text-signal-alert">{createError}</p>}
        </form>
      )}

      <div className="card">
        {loadError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-signal-alert">{loadError}</p>
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        ) : devices.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                <rect x="4" y="4" width="16" height="7" rx="1.5" />
                <rect x="4" y="13" width="16" height="7" rx="1.5" />
                <path d="M8 7.5h.01M8 16.5h.01" />
              </svg>
            }
            message="No routers linked yet — add one to get its provisioning script."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
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
                <tr key={d.id} className="border-t border-signal-border">
                  <td className="py-2 pr-4 font-medium text-signal-ink">{d.name}</td>
                  <td className="py-2 pr-4 text-signal-ink-dim">{d.site ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "never"}
                  </td>
                  <td className="py-2 pr-4">
                    {confirmRegenerateId === d.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-signal-alert">This will disconnect it.</span>
                        <button
                          className="text-sm font-medium text-signal-alert"
                          onClick={() => handleGenerateScript(d.id, true)}
                        >
                          Regenerate anyway
                        </button>
                        <button
                          className="text-sm font-medium text-signal-ink-dim"
                          onClick={() => setConfirmRegenerateId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : d.wireguard_client_privkey ? (
                      <span className="flex items-center gap-3">
                        <button className="btn-secondary py-1.5" onClick={() => handleShowBootstrap(d)}>
                          View setup script
                        </button>
                        <button
                          className="text-xs font-medium text-signal-ink-dim hover:text-signal-alert"
                          onClick={() => handleGenerateScript(d.id)}
                        >
                          Regenerate credentials
                        </button>
                      </span>
                    ) : (
                      <button className="btn-secondary py-1.5" onClick={() => handleGenerateScript(d.id)}>
                        Get setup script
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scriptError && <p className="text-sm text-signal-alert">{scriptError}</p>}

      {scriptFor && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-signal-ink">RouterOS setup script</h2>
            <button className="text-sm text-signal-ink-dim" onClick={() => setScriptFor(null)}>
              Close
            </button>
          </div>
          {loadingScript ? (
            <p className="text-sm text-signal-ink-dim">Generating…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-sm text-signal-ink-dim">
                  Paste these lines into a New Terminal on the router. It sets up the WireGuard
                  tunnel, hotspot network (bridge, DHCP, wireless), RADIUS, walled garden, and pulls the
                  captive portal — one time, no follow-up needed. Pasting the full script directly tends
                  to get corrupted on long lines in WinBox&apos;s terminal, which is why this fetches it as a
                  file instead.
                </p>
                <p className="mb-2 text-xs font-bold text-signal-alert">
                  Use the Copy button below, not manual selection — the last line (the actual{" "}
                  <code>/import</code>) is easy to drop by accident when drag-selecting, and the router
                  silently does nothing without it.
                </p>
                <div className="flex flex-col gap-2">
                  <textarea
                    readOnly
                    className="input h-32 font-mono text-xs"
                    value={bootstrap}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="btn-secondary self-start py-1.5" onClick={copyBootstrap}>
                    {bootstrapCopied ? "Copied ✓ (all 5 lines)" : "Copy all 5 lines"}
                  </button>
                </div>
              </div>

              {waitingSince && (() => {
                const device = devices.find((d) => d.id === scriptFor);
                const linked = device?.status === "linked";
                return (
                  <div
                    className={`rounded-tight border p-3 text-xs ${
                      linked
                        ? "border-signal-pulse/30 bg-signal-pulse-soft text-signal-pulse"
                        : "border-signal-border bg-signal-ink-faint/10 text-signal-ink-dim"
                    }`}
                  >
                    {linked ? (
                      <p className="font-bold">✓ Linked — this router checked in and is live.</p>
                    ) : (
                      <p>
                        Waiting for the router to check in
                        {elapsedSec > 0 && <span className="font-mono tabular-nums"> — {elapsedSec}s</span>}
                        . Runs the script, then reports back on its first heartbeat — usually 10–60s after{" "}
                        <code>/import</code> finishes, not the 5-minute heartbeat interval.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="rounded-tight border border-signal-border bg-signal-voucher-soft p-3 text-xs text-signal-ink-dim">
                <p className="mb-1 font-bold text-signal-ink">If it doesn&apos;t show &quot;linked&quot; within ~5 minutes:</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  <li>Check <code>/system ntp client print</code> — if the clock never synced, HTTPS fetches fail silently.</li>
                  <li>Check <code>/interface wireguard peers print</code> — look for a recent handshake.</li>
                  <li>Check <code>/ip hotspot print</code> and <code>/ip dhcp-server print</code> exist and aren&apos;t disabled.</li>
                  <li>Confirm ether1 is really your WAN port on this hardware — everything else gets bridged into the hotspot.</li>
                </ul>
              </div>

              <button
                type="button"
                className="self-start text-sm font-medium text-signal-brand"
                onClick={() => {
                  const next = !showFullScript;
                  setShowFullScript(next);
                  const device = devices.find((d) => d.id === scriptFor);
                  if (next && !script && device) loadFullScript(device);
                }}
              >
                {showFullScript ? "Hide full script" : "Show full script (manual import)"}
              </button>
              {showFullScript && (
                <textarea
                  readOnly
                  className="input h-80 font-mono text-xs"
                  value={loadingScript ? "Loading…" : script}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
