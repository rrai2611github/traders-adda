import { UserManager } from "@/components/admin/UserManager";
import { AccountMenu } from "@/components/auth/AccountMenu";

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Traders Adda</p>
          <h1 className="mt-1 text-xl font-black text-slate-900">Admin tools</h1>
        </div>
        <AccountMenu />
      </header>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Manage members</h2>
          <p className="mt-1 text-sm text-slate-600">Review registrations, change account roles, or disable and restore access.</p>
        </div>
        <UserManager />
      </div>
    </main>
  );
}
