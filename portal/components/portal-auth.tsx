"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { isPortalSupabaseConfigured, portalSupabase } from "@/lib/supabase-browser";

export function usePortalSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = portalSupabase;
    if (!client) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    let live = true;
    void client.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      if (!live) return;
      setSession(next);
      setLoading(false);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { configured: isPortalSupabaseConfigured, loading, session };
}

export function PortalAuth({ allowSignup, title, body }: { allowSignup: boolean; title: string; body: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portalSupabase) {
      setMessage("Supabase public environment variables are not connected to this deployment yet.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const result = mode === "signup"
      ? await portalSupabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { display_name: name.trim(), full_name: name.trim() } } })
      : await portalSupabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) setMessage("Check your email for the verification link, then return here to sign in.");
  }

  return (
    <section className="auth-panel" aria-labelledby="portal-auth-title">
      <div className="auth-panel__copy">
        <p className="section-kicker">Secure access</p>
        <h2 id="portal-auth-title">{title}</h2>
        <p>{body}</p>
        <div className="auth-trust-list"><span>✓ Email verification</span><span>✓ Scoped access</span><span>✓ Audited operator actions</span></div>
      </div>
      <form className="portal-form" onSubmit={(event) => void submit(event)}>
        {allowSignup ? <div className="auth-tabs"><button aria-pressed={mode === "login"} onClick={() => setMode("login")} type="button">Sign in</button><button aria-pressed={mode === "signup"} onClick={() => setMode("signup")} type="button">Create account</button></div> : null}
        {mode === "signup" ? <label>Full name<input autoComplete="name" minLength={2} onChange={(event) => setName(event.target.value)} required value={name} /></label> : null}
        <label>Email address<input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label>Password<input autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <button className="portal-primary-button" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Create agent account" : "Continue securely"}</button>
        <small>Credentials go directly to Supabase Auth. KampusOne never stores your password in portal tables.</small>
      </form>
    </section>
  );
}
