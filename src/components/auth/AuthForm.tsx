"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          callbackURL: "/",
        });
        if (result.error) throw new Error(result.error.message || "Could not create your account.");
        setMessage("Account created. Check your email and verify your address before signing in.");
      } else {
        const result = await authClient.signIn.email({
          email: email.trim().toLowerCase(),
          password,
        });
        if (result.error) throw new Error(result.error.message || "Could not sign in.");
        router.replace("/");
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === "register";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Traders Adda</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          {registering ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {registering ? "Register to use the research dashboard and your private paper-trading workspace." : "Sign in to open your research and private paper-trading workspace."}
        </p>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          {registering && (
            <label className="block text-sm font-bold text-slate-700">
              Name
              <input
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          )}
          <label className="block text-sm font-bold text-slate-700">
            Email
            <input
              autoComplete="email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Password
            <input
              autoComplete={registering ? "new-password" : "current-password"}
              type="password"
              required
              minLength={registering ? 12 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
            {registering && <span className="mt-1 block text-xs font-medium text-slate-500">Use at least 12 characters.</span>}
          </label>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{message}</p>}
          <button
            type="submit"
            disabled={busy}
            className="h-11 w-full rounded-xl bg-emerald-700 px-4 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {registering ? "Already registered? " : "New here? "}
          <Link className="font-bold text-emerald-700 hover:underline" href={registering ? "/login" : "/register"}>
            {registering ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
