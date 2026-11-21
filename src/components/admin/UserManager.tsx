"use client";

import { useCallback, useEffect, useState } from "react";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  createdAt: string;
}

interface UserResponse {
  users: UserRow[];
  total: number;
  error?: string;
}

export function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const result = await response.json() as UserResponse;
    if (!response.ok) throw new Error(result.error ?? `Could not load users (${response.status}).`);
    setUsers(result.users);
    setTotal(result.total);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/users", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as UserResponse;
        if (!response.ok) throw new Error(result.error ?? `Could not load users (${response.status}).`);
        if (active) {
          setUsers(result.users);
          setTotal(result.total);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load users.");
      });
    return () => { active = false; };
  }, []);

  async function update(user: UserRow, action: "role" | "ban" | "unban", role?: "user" | "admin") {
    setBusy(user.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: user.id, role }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Update failed (${response.status}).`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this account.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-black text-slate-900">Registered accounts</h2>
          <p className="mt-1 text-xs text-slate-500">{total} account{total === 1 ? "" : "s"} · showing up to 100</p>
        </div>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Name / email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-5 py-3 text-right">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-5 py-3">
                  <p className="font-bold text-slate-800">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={user.banned ? "text-rose-700" : user.emailVerified ? "text-emerald-700" : "text-amber-700"}>
                    {user.banned ? "Disabled" : user.emailVerified ? "Verified" : "Unverified"}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-slate-700">{user.role}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy === user.id}
                      onClick={() => void update(user, "role", user.role === "admin" ? "user" : "admin")}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                      {user.role === "admin" ? "Make member" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === user.id || user.role === "admin"}
                      onClick={() => void update(user, user.banned ? "unban" : "ban")}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                      {user.banned ? "Enable" : "Disable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && !error && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">No accounts have registered yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
