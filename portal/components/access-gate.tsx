"use client";

import Image from "next/image";
import { type FormEvent, type ReactNode, useState } from "react";
import { usePortalAuth } from "@/components/auth-provider";
import { AgentAccess } from "@/components/agent-access";
import { PortalApiError, webAuth } from "@/lib/api";

type AuthMode = "login" | "forgot" | "reset";

export function AccessGate({
  surface,
  children,
}: {
  surface: "admin" | "agents" | "engineering";
  children: ReactNode;
}) {
  const { status, start, user, signOut, restoreError, retryRestore } =
    usePortalAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const address = String(form.get("email")).trim();
      if (mode === "login") {
        start(await webAuth.login(address, String(form.get("password"))));
      } else if (mode === "forgot") {
        await webAuth.forgotPassword(address);
        setEmail(address);
        setMode("reset");
        setNotice(
          "If that account exists, a six-digit reset code is on its way.",
        );
      } else {
        await webAuth.resetPassword(
          address,
          String(form.get("code")),
          String(form.get("password")),
        );
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Couldn’t complete the request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading")
    return (
      <main
        className="session-loader"
        aria-live="polite"
        aria-busy={!restoreError}
      >
        <p>{restoreError || "Checking your session…"}</p>
        {restoreError ? (
          <button
            className="button button--primary"
            onClick={() => void retryRestore()}
          >
            Try again
          </button>
        ) : null}
      </main>
    );

  if (status === "authenticated") {
    const allowed =
      surface === "agents" ||
      (surface === "engineering" &&
        user?.operatorRoles.includes("PLATFORM_ADMIN")) ||
      // AdminProvider checks /v1/admin/access before rendering any workspace.
      surface === "admin";
    if (allowed) return children;
    return (
      <main className="agent-login-page">
        <section className="agent-login-shell">
          <Image
            src="/kampusone-horizontal-ink.png"
            alt="KampusOne"
            width={202}
            height={49}
            priority
          />
          <h1>Staff access required</h1>
          <p className="muted">
            Signed in as {user?.email}. Ask a platform administrator to assign
            workspace access.
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await signOut();
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Couldn’t sign out. Please try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </section>
      </main>
    );
  }

  if (surface === "agents") return <AgentAccess onAuthenticated={start} />;
  return (
    <main className="agent-login-page">
      <section
        className="agent-login-shell"
        aria-labelledby="staff-sign-in-title"
      >
        <Image
          src="/kampusone-horizontal-ink.png"
          alt="KampusOne"
          width={202}
          height={49}
          priority
        />
        <header className="agent-login-heading">
          <h1 id="staff-sign-in-title">
            {mode === "login"
              ? "Staff sign in"
              : mode === "forgot"
                ? "Reset password"
                : "Choose a new password"}
          </h1>
          {mode === "login" ? (
            <p>Use your provisioned KampusOne account.</p>
          ) : null}
        </header>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          {mode === "reset" ? (
            <label>
              Six-digit code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={busy}
              />
            </label>
          ) : null}
          {mode !== "forgot" ? (
            <label>
              {mode === "reset" ? "New password" : "Password"}
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "reset" ? "new-password" : "current-password"
                }
                minLength={mode === "reset" ? 10 : 1}
                maxLength={128}
                required
                disabled={busy}
              />
            </label>
          ) : null}
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button--primary button--wide"
            disabled={busy}
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "forgot"
                  ? "Send reset code"
                  : "Update password"}
          </button>
        </form>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setError("");
            setNotice("");
            setMode(mode === "login" ? "forgot" : "login");
          }}
        >
          {mode === "login" ? "Forgot your password?" : "Back to sign in"}
        </button>
      </section>
    </main>
  );
}
