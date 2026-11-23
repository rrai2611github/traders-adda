"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void fetch("/api/visitor", { method: "POST", keepalive: true })
      .then((response) => {
        if (!response.ok) throw new Error(`Visitor count request failed (${response.status}).`);
      })
      .catch((error: unknown) => console.error("[visitor-count] request failed:", error));
  }, [userId]);

  if (isPending) return null;
  if (!session) {
    return <Link href="/login" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Sign in</Link>;
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-l border-slate-200 pl-3">
      <div className="hidden text-right sm:block">
        <p className="max-w-36 truncate text-xs font-bold text-slate-800">{session.user.name}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{session.user.role === "admin" ? "Admin" : "Member"}</p>
      </div>
      {session.user.role === "admin" && (
        <Link href="/admin" className="rounded-lg px-2 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Admin</Link>
      )}
      <button type="button" onClick={signOut} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
        Sign out
      </button>
    </div>
  );
}
