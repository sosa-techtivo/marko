"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MarkoLogo } from "@/components/MarkoLogo";
import { ORGANIZATION_NAME_MAX_LENGTH, normalizeOrganizationName } from "@/lib/organizationName";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
      return;
    }

    const pendingOrganizationName = normalizeOrganizationName(organizationName);
    if (!pendingOrganizationName) {
      setError("Please provide an organization name.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          pending_organization_name: pendingOrganizationName,
        },
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email to confirm your account.");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-7 bg-zinc-50 px-4">
      <MarkoLogo
        align="center"
        imageClassName="h-8 w-auto"
        textClassName="text-[11px] font-semibold tracking-wide"
        gapClassName="mt-3"
      />
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-md">
        <h1 className="text-xl font-bold text-zinc-900">
          {mode === "sign-in" ? "Welcome back" : "Create your MARKO account"}
        </h1>
        {mode === "sign-in" && (
          <p className="mt-4 text-sm text-zinc-500">Sign in to your MARKO workspace.</p>
        )}
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
          {mode === "sign-up" && (
            <div className="flex flex-col">
              <label
                htmlFor="organizationName"
                className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5"
              >
                Organization name
              </label>
              <input
                id="organizationName"
                type="text"
                autoComplete="organization"
                required
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                placeholder="Techtivo"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <div className="flex flex-col">
            <label
              htmlFor="email"
              className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-col">
            <label
              htmlFor="password"
              className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setOrganizationName("");
            setError(null);
            setMessage(null);
          }}
          className="mt-4 text-sm text-zinc-500 hover:text-primary-strong"
        >
          {mode === "sign-in"
            ? "Don't have an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
