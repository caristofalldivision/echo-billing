"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/functions";

interface Member {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "owner" | "staff";
  created_at: string;
}

export default function TeamSettingsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<"owner" | "staff" | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [newCredentials, setNewCredentials] = useState<{ email: string; tempPassword: string } | null>(
    null,
  );

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setMyId(user.id);
      const { data: mine } = await supabase.from("admin_users").select("role").eq("id", user.id).single();
      setMyRole(mine?.role ?? null);
    }

    const { data, error } = await supabase.functions.invoke("admin-list-users");
    if (error) {
      setLoadError("Couldn't load your team. Please try again.");
    } else {
      setMembers(data?.members ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const { data, error } = await supabase.functions.invoke("admin-add-user", {
      body: { email, fullName, role },
    });
    setAdding(false);
    if (error) {
      setAddError(await getFunctionErrorMessage(error, "Couldn't add that team member."));
      return;
    }
    setNewCredentials({ email: data.email, tempPassword: data.tempPassword });
    setShowAddForm(false);
    setFullName("");
    setEmail("");
    setRole("staff");
    load();
  }

  async function handleRoleChange(userId: string, newRole: "owner" | "staff") {
    setBusyId(userId);
    setRowError(null);
    const { error } = await supabase.functions.invoke("admin-update-role", {
      body: { userId, role: newRole },
    });
    setBusyId(null);
    if (error) {
      setRowError(await getFunctionErrorMessage(error, "Couldn't update that role."));
      return;
    }
    load();
  }

  async function handleRemove(userId: string) {
    setBusyId(userId);
    setRowError(null);
    const { error } = await supabase.functions.invoke("admin-remove-user", {
      body: { userId },
    });
    setBusyId(null);
    setConfirmRemoveId(null);
    if (error) {
      setRowError(await getFunctionErrorMessage(error, "Couldn't remove that team member."));
      return;
    }
    load();
  }

  const isOwner = myRole === "owner";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-echo-ink">Team</h1>
          <p className="text-sm text-echo-muted">
            {isOwner
              ? "Add staff accounts and manage who has owner access."
              : "Only owners can add or manage team members."}
          </p>
        </div>
        {isOwner && (
          <button className="btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? "Cancel" : "Add team member"}
          </button>
        )}
      </div>

      {isOwner && showAddForm && (
        <form onSubmit={handleAdd} className="card flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Full name</label>
            <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as "owner" | "staff")}
            >
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={adding}>
            {adding ? "Adding…" : "Add"}
          </button>
          {addError && <p className="w-full text-sm text-echo-coral-500">{addError}</p>}
        </form>
      )}

      {newCredentials && (
        <div className="card flex flex-col gap-3 border-echo-mint-500/60 bg-echo-mint-50">
          <h3 className="font-display text-lg font-bold">Account created</h3>
          <p className="text-sm text-echo-muted">
            Share this temporary password with <strong>{newCredentials.email}</strong> securely — it
            won&apos;t be shown again. They can change it from Settings &gt; Account after signing in.
          </p>
          <code className="w-fit rounded-lg bg-white px-3 py-2 font-mono text-sm">
            {newCredentials.tempPassword}
          </code>
          <button className="btn-secondary self-start" onClick={() => setNewCredentials(null)}>
            Done
          </button>
        </div>
      )}

      {rowError && <p className="text-sm text-echo-coral-500">{rowError}</p>}

      <div className="card">
        {loading ? (
          <p className="py-6 text-center text-sm text-echo-muted">Loading…</p>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-echo-coral-500">{loadError}</p>
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-echo-indigo-100/70 text-left text-echo-muted">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Joined</th>
                  {isOwner && <th className="pb-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-echo-indigo-100/40 last:border-0">
                    <td className="py-3">
                      {m.full_name ?? "—"} {m.id === myId && <span className="text-echo-muted">(you)</span>}
                    </td>
                    <td className="py-3">{m.email}</td>
                    <td className="py-3">
                      {isOwner && m.id !== myId ? (
                        <select
                          className="input w-32"
                          value={m.role}
                          disabled={busyId === m.id}
                          onChange={(e) => handleRoleChange(m.id, e.target.value as "owner" | "staff")}
                        >
                          <option value="staff">Staff</option>
                          <option value="owner">Owner</option>
                        </select>
                      ) : (
                        <span
                          className={`badge ${m.role === "owner" ? "bg-echo-indigo-50 text-echo-indigo-600" : "bg-echo-amber-100/60 text-echo-amber-500"}`}
                        >
                          {m.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-echo-muted">
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    {isOwner && (
                      <td className="py-3">
                        {m.id === myId ? (
                          <span className="text-echo-muted">—</span>
                        ) : confirmRemoveId === m.id ? (
                          <span className="flex items-center gap-2">
                            <button
                              className="text-sm font-medium text-echo-coral-500"
                              disabled={busyId === m.id}
                              onClick={() => handleRemove(m.id)}
                            >
                              Confirm
                            </button>
                            <button
                              className="text-sm font-medium text-echo-muted"
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="text-sm font-medium text-echo-coral-500 hover:underline"
                            onClick={() => setConfirmRemoveId(m.id)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
