"use client";

import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/functions";
import type { IpAllowlistEntry, MikrotikDevice } from "@/lib/supabase/types";
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bootstrapCopied, setBootstrapCopied] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [ipListFor, setIpListFor] = useState<string | null>(null);
  const [ipEntries, setIpEntries] = useState<IpAllowlistEntry[]>([]);
  const [newIp, setNewIp] = useState("");
  const [newIpLabel, setNewIpLabel] = useState("");
  const [ipError, setIpError] = useState<string | null>(null);
  const [addingIp, setAddingIp] = useState(false);

  async function loadIpEntries(deviceId: string) {
    const { data } = await supabase
      .from("ip_allowlist")
      .select("*")
      .eq("mikrotik_device_id", deviceId)
      .order("created_at", { ascending: false });
    setIpEntries(data ?? []);
  }

  function openIpList(deviceId: string) {
    setIpListFor(deviceId);
    setNewIp("");
    setNewIpLabel("");
    setIpError(null);
    loadIpEntries(deviceId);
  }

  async function addIp(e: React.FormEvent) {
    e.preventDefault();
    if (!ipListFor) return;
    setAddingIp(true);
    setIpError(null);
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("ip_allowlist").insert({
      org_id: org?.id,
      mikrotik_device_id: ipListFor,
      ip_address: newIp,
      label: newIpLabel || null,
    });
    setAddingIp(false);
    if (error) {
      setIpError(error.message);
      return;
    }
    setNewIp("");
    setNewIpLabel("");
    loadIpEntries(ipListFor);
  }

  async function removeIp(id: string) {
    if (!ipListFor) return;
    await supabase.from("ip_allowlist").delete().eq("id", id);
    loadIpEntries(ipListFor);
  }

  // Deleting a device row also revokes it: radius-service's syncPeers()
  // tears down the matching WireGuard peer on its next reconciliation pass
  // (runs every WIREGUARD_PEER_SYNC_INTERVAL_MS, 30s by default), and RLS
  // means the row is really gone, not just hidden — vouchers/PPPoE accounts
  // that had referenced this device just become unassigned (migration
  // 0010_device_deletion.sql), they aren't deleted. A still-provisioned
  // router isn't reset by this — its own config keeps running — it just
  // loses its RADIUS/heartbeat path back to Echo, so it stops authenticating
  // anyone until it's re-provisioned with a fresh device row.
  async function deleteDevice(id: string) {
    setDeletingId(id);
    const { error } = await supabase.from("mikrotik_devices").delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      setLoadError(`Couldn't delete: ${error.message}`);
      return;
    }
    setConfirmDeleteId(null);
    load();
  }

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
      `:put "[Echo] 1/4 — bringing up WAN (ether1)..."; :if ([:len [/ip address find interface=ether1]] = 0) do={ /ip dhcp-client add interface=ether1 disabled=no add-default-route=yes use-peer-dns=yes }; :local wanWait 0; :while ($wanWait < 20 and [:len [/ip address find interface=ether1]] = 0) do={ :delay 1s; :set wanWait ($wanWait + 1) }; :put "[Echo] 2/4 — syncing clock..."; /system ntp client set enabled=yes; :if ([:len [/system ntp client servers find address="pool.ntp.org"]] = 0) do={ /system ntp client servers add address=pool.ntp.org }; :delay 5s; :put "[Echo] 3/4 — fetching setup script..."; /tool fetch url="${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/provisioning-fetch?token=${device.provisioning_token}" dst-path="echo-setup.rsc" mode=https; :put "[Echo] 4/4 — running full setup (WireGuard, hotspot, RADIUS, captive portal)..."; /import file-name=echo-setup.rsc; :put "[Echo] Bootstrap finished. Look for 'Echo provisioning complete' just above — if it's missing, something failed partway; scroll up for the error."\n`,
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
                    {confirmDeleteId === d.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-signal-alert">
                          {d.status === "linked"
                            ? "This router is active — deleting it cuts off its RADIUS/heartbeat access immediately."
                            : "Delete this device? Its vouchers/PPPoE accounts stay, just unassigned."}
                        </span>
                        <button
                          className="text-sm font-medium text-signal-alert"
                          disabled={deletingId === d.id}
                          onClick={() => deleteDevice(d.id)}
                        >
                          {deletingId === d.id ? "Deleting…" : "Delete anyway"}
                        </button>
                        <button
                          className="text-sm font-medium text-signal-ink-dim"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : confirmRegenerateId === d.id ? (
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
                        <button className="btn-secondary py-1.5" onClick={() => openIpList(d.id)}>
                          Allowed IPs
                        </button>
                        <button
                          className="text-xs font-medium text-signal-ink-dim hover:text-signal-alert"
                          onClick={() => handleGenerateScript(d.id)}
                        >
                          Regenerate credentials
                        </button>
                        <button
                          className="text-xs font-medium text-signal-ink-dim hover:text-signal-alert"
                          onClick={() => setConfirmDeleteId(d.id)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-3">
                        <button className="btn-secondary py-1.5" onClick={() => handleGenerateScript(d.id)}>
                          Get setup script
                        </button>
                        <button
                          className="text-xs font-medium text-signal-ink-dim hover:text-signal-alert"
                          onClick={() => setConfirmDeleteId(d.id)}
                        >
                          Delete
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
                  Paste this one line into a New Terminal on the router and press Enter. It sets up the
                  WireGuard tunnel, hotspot network (bridge, DHCP, wireless), RADIUS, walled garden, and
                  pulls the captive portal — one time, no follow-up needed. It&apos;s deliberately a single{" "}
                  <code>;</code>-chained statement rather than separate lines — RouterOS then either runs
                  the whole thing start to finish or doesn&apos;t parse it at all, so there&apos;s nothing to
                  silently drop partway through the way separate lines could be. Watch for the{" "}
                  <code>[Echo] 1/2</code> / <code>2/2</code> / <code>Echo provisioning complete</code>{" "}
                  messages as it runs — that&apos;s your confirmation it actually executed.
                </p>
                <div className="flex flex-col gap-2">
                  <textarea
                    readOnly
                    className="input h-32 font-mono text-xs"
                    value={bootstrap}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="btn-secondary self-start py-1.5" onClick={copyBootstrap}>
                    {bootstrapCopied ? "Copied ✓" : "Copy"}
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
                        . The script fires an immediate heartbeat as its last step, so this should flip
                        within seconds of <code>Echo provisioning complete</code> printing on the router —
                        it doesn&apos;t wait for the recurring 2-minute heartbeat schedule.
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

      {ipListFor && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-signal-ink">Allowed IPs</h2>
            <button className="text-sm text-signal-ink-dim" onClick={() => setIpListFor(null)}>
              Close
            </button>
          </div>
          <p className="mb-4 text-sm text-signal-ink-dim">
            Static IPs on this router that connect straight through the hotspot — no voucher, no payment.
            Good for an office PC, printer, or a device you never want asked to log in. The router picks
            up changes here within 5 minutes (its own <code>echo-ip-sync</code> schedule), or immediately
            the next time it&apos;s (re)provisioned.
          </p>

          <form onSubmit={addIp} className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">IP address</label>
              <input className="input" required value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="10.55.0.50" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-signal-ink-faint">Label (optional)</label>
              <input className="input" value={newIpLabel} onChange={(e) => setNewIpLabel(e.target.value)} placeholder="Office printer" />
            </div>
            <button type="submit" className="btn-primary" disabled={addingIp}>
              {addingIp ? "Adding…" : "Add"}
            </button>
          </form>
          {ipError && <p className="mb-3 text-sm text-signal-alert">{ipError}</p>}

          {ipEntries.length === 0 ? (
            <p className="py-4 text-center text-sm text-signal-ink-dim">No always-allowed IPs on this router yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wide text-signal-ink-faint">
                <tr>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Added</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {ipEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-signal-border">
                    <td className="py-2 pr-4 font-mono text-signal-ink">{entry.ip_address}</td>
                    <td className="py-2 pr-4 text-signal-ink-dim">{entry.label ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-signal-ink-dim">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4">
                      <button className="text-xs font-bold text-signal-alert" onClick={() => removeIp(entry.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
