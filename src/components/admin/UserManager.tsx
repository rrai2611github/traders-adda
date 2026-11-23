"use client";

import { useEffect, useState } from "react";

const PAGE_SIZE = 100;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

interface UserResponse {
  users: UserRow[];
  total: number;
  error?: string;
}

interface AppliedSearch {
  value: string;
  field: "name" | "email";
}

type AccountFilter = "all" | "admins" | "members" | "enabled" | "disabled" | "verified" | "unverified";

function formatAccountDate(value: string | null, includeTime = false) {
  if (!value) return "No recorded visits";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchField, setSearchField] = useState<AppliedSearch["field"]>("email");
  const [search, setSearch] = useState<AppliedSearch | null>(null);
  const [filterInput, setFilterInput] = useState<AccountFilter>("all");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedRequest, setLoadedRequest] = useState<{ offset: number; refreshKey: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loading = loadedRequest?.offset !== offset || loadedRequest?.refreshKey !== refreshKey;

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search) {
      query.set("searchValue", search.value);
      query.set("searchField", search.field);
    }
    if (filter !== "all") query.set("filter", filter);
    void fetch(`/api/admin/users?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as UserResponse;
        if (!response.ok) throw new Error(result.error ?? `Could not load users (${response.status}).`);
        if (active) {
          setUsers(result.users);
          setTotal(result.total);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load users.");
      })
      .finally(() => {
        if (active) setLoadedRequest({ offset, refreshKey });
      });
    return () => { active = false; };
  }, [offset, refreshKey, search, filter]);

  async function update(user: UserRow, action: "role" | "ban" | "unban", role?: "user" | "admin") {
    setBusy(user.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: user.id, role }),
      });
      const result = await response.json() as { error?: string; actionApplied?: boolean };
      if (!response.ok) {
        if (result.actionApplied) {
          setRefreshKey((key) => key + 1);
          window.dispatchEvent(new Event("admin-audit-updated"));
        }
        throw new Error(result.error ?? `Update failed (${response.status}).`);
      }
      setRefreshKey((key) => key + 1);
      window.dispatchEvent(new Event("admin-audit-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this account.");
    } finally {
      setBusy(null);
    }
  }

  const firstUser = total === 0 ? 0 : offset + 1;
  const lastUser = Math.min(offset + users.length, total);
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-black text-slate-900">Registered accounts</h2>
          <p className="mt-1 text-xs text-slate-500">
            {loading && total === 0 ? "Loading accounts…" : `${total} account${total === 1 ? "" : "s"} · showing ${firstUser}–${lastUser}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Page {pageNumber} of {pageCount}</span>
          <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">Previous</button>
          <button type="button" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">Next</button>
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSearch(searchInput.trim() ? { value: searchInput.trim(), field: searchField } : null);
          setFilter(filterInput);
        }}
      >
        <label className="sr-only" htmlFor="admin-user-search">Search registered accounts</label>
        <input
          id="admin-user-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          maxLength={100}
          placeholder="Search name or email"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"
        />
        <label className="sr-only" htmlFor="admin-user-search-field">Search field</label>
        <select
          id="admin-user-search-field"
          value={searchField}
          onChange={(event) => setSearchField(event.target.value === "name" ? "name" : "email")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="email">Email</option>
          <option value="name">Name</option>
        </select>
        <label className="sr-only" htmlFor="admin-account-filter">Filter accounts</label>
        <select
          id="admin-account-filter"
          value={filterInput}
          onChange={(event) => {
            const value = event.target.value;
            setFilterInput(value === "admins" || value === "members" || value === "enabled" || value === "disabled" || value === "verified" || value === "unverified" ? value : "all");
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All accounts</option>
          <option value="admins">Admins</option>
          <option value="members">Members</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="verified">Verified email</option>
          <option value="unverified">Unverified email</option>
        </select>
        <button type="submit" disabled={loading} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Search</button>
        {(search || filter !== "all") && (
          <button type="button" onClick={() => { setSearchInput(""); setSearch(null); setFilterInput("all"); setFilter("all"); setOffset(0); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">
            Clear filters
          </button>
        )}
      </form>
      {error && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Name / email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-5 py-3 text-right">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">Loading accounts…</td></tr>
            ) : users.map((user) => (
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
                <td className="px-4 py-3 text-xs text-slate-600">{formatAccountDate(user.createdAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{formatAccountDate(user.lastActiveAt, true)}{user.lastActiveAt ? " IST" : ""}</td>
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
            {!loading && !users.length && !error && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">{search || filter !== "all" ? "No accounts match these filters." : "No accounts have registered yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
