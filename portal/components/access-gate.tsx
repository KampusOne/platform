"use client";

import Image from "next/image";
import { type FormEvent, type ReactNode, useState } from "react";

import { usePortalAuth } from "@/components/auth-provider";
import { AgentAccess } from "@/components/agent-access";
import { PortalApiError, portalApi, webAuth } from "@/lib/api";

type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";

const surfaceCopy = {
  admin: {
    eyebrow: "KampusOne administration",
    title: "Run campus operations with real evidence.",
    body: "Review users and agents, publish trusted campus information, follow revenue, and inspect every privileged action.",
    image: "/brand-scenes/campus-life.png",
  },
  agents: {
    eyebrow: "KampusOne agents",
    title: "Build a trusted campus business.",
    body: "Sign in before applying as a tutor, vendor, or rider. Your application and every operational action stay attached to your verified identity.",
    image: "/brand-scenes/tutorials.png",
  },
  engineering: {
    eyebrow: "KampusOne engineering",
    title: "Know what is ready before release.",
    body: "Inspect live service readiness, provider configuration, feature gates, and the exact requirements blocking each phase.",
    image: "/brand-scenes/rider.png",
  },
} as const;

function messageFrom(error: unknown) {
  return error instanceof PortalApiError
    ? error.message
    : "Something interrupted the request. Please try again.";
}

export function AccessGate({
  surface,
  children,
}: {
  surface: keyof typeof surfaceCopy;
  children: ReactNode;
}) {
  const { status, start, user, signOut } = usePortalAuth();
  const copy = surfaceCopy[surface];
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
      if (mode === "login") {
        start(
          await webAuth.login(
            String(form.get("email")),
            String(form.get("password")),
          ),
        );
      } else if (mode === "register") {
        const nextEmail = String(form.get("email"));
        await webAuth.register({
          email: nextEmail,
          password: String(form.get("password")),
          firstName: String(form.get("firstName")),
          lastName: String(form.get("lastName")),
        });
        setEmail(nextEmail);
        setMode("verify");
        setNotice(
          `If ${nextEmail} can be registered, a six-digit code is on its way.`,
        );
      } else if (mode === "verify") {
        start(
          await webAuth.verify(
            email || String(form.get("email")),
            String(form.get("code")),
          ),
        );
      } else if (mode === "forgot") {
        const nextEmail = String(form.get("email"));
        await webAuth.forgotPassword(nextEmail);
        setEmail(nextEmail);
        setMode("reset");
        setNotice(
          "If that account exists, a six-digit reset code has been sent.",
        );
      } else {
        await webAuth.resetPassword(
          email || String(form.get("email")),
          String(form.get("code")),
          String(form.get("password")),
        );
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function bootstrapAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bootstrapToken = String(form.get("bootstrapToken") ?? "").trim();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/admin/bootstrap", {
        method: "POST",
        headers: bootstrapToken
          ? { "X-Admin-Bootstrap-Token": bootstrapToken }
          : undefined,
        body: "{}",
      });
      const renewed = await webAuth.refresh();
      if (!renewed)
        throw new Error("The administrator session could not be renewed.");
      start(renewed);
      setNotice("The first administrator account is active.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="session-loader">
        <span className="spinner" />
        <p>Checking your secure session…</p>
      </main>
    );
  }
  if (status === "authenticated") {
    const allowed =
      surface === "agents" ||
      (surface === "engineering" &&
        user?.operatorRoles.includes("PLATFORM_ADMIN")) ||
      (surface === "admin" &&
        user?.operatorRoles.some((role) =>
          [
            "PLATFORM_ADMIN",
            "INSTITUTION_ADMIN",
            "CONTENT_EDITOR",
            "VERIFICATION_REVIEWER",
            "SUPPORT",
            "FINANCE_REVIEWER",
          ].includes(role),
        ));
    if (allowed) return children;

    return (
      <main className="auth-page">
        <section className="auth-story">
          <div className="auth-story__brand">
            <Image
              src="/kampusone-horizontal-ink.png"
              alt="KampusOne"
              width={202}
              height={49}
              priority
            />
          </div>
          <div className="auth-story__copy">
            <p className="eyebrow">Verified identity · restricted workspace</p>
            <h1>
              Your account is signed in, but this workspace is role-protected.
            </h1>
            <p>
              Operational access is assigned from trusted server records.
              Registering an account never grants administrator or engineering
              permissions automatically.
            </p>
          </div>
          <Image
            className="auth-story__image"
            src={copy.image}
            alt="KampusOne campus operations"
            width={1024}
            height={1024}
            priority
          />
        </section>
        <section className="auth-panel">
          <div className="auth-panel__inner">
            <p className="auth-panel__kicker">Access control</p>
            <h2>
              {surface === "admin"
                ? "Administrator access required"
                : "Platform administrator required"}
            </h2>
            <p className="muted">
              Signed in as {user?.email}. Ask an existing platform administrator
              to assign the correct scoped role.
            </p>
            {surface === "admin" ? (
              <form className="form-stack" onSubmit={bootstrapAdmin}>
                <p className="field-help">
                  For the one-time first-admin setup, the verified email
                  configured by the deployment can activate itself. No shared
                  default password is created.
                </p>
                {notice && (
                  <p className="form-notice" role="status">
                    {notice}
                  </p>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="button button--primary button--wide"
                  disabled={busy}
                >
                  {busy ? "Activating…" : "Activate this verified account"}
                </button>
                <details>
                  <summary>Use a recovery setup credential</summary>
                  <label>
                    Bootstrap credential
                    <input
                      name="bootstrapToken"
                      type="password"
                      minLength={24}
                      autoComplete="off"
                    />
                  </label>
                  <p className="field-help">
                    Deployment recovery only. Remove the secret after
                    first-admin setup.
                  </p>
                  <button
                    className="button button--secondary button--wide"
                    disabled={busy}
                    type="submit"
                  >
                    Activate with credential
                  </button>
                </details>
              </form>
            ) : null}
            <button
              className="button button--secondary button--wide"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (surface === "agents") {
    return <AgentAccess onAuthenticated={start} />;
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story__brand">
          <Image
            src="/kampusone-horizontal-ink.png"
            alt="KampusOne"
            width={202}
            height={49}
            priority
          />
        </div>
        <div className="auth-story__copy">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </div>
        <Image
          className="auth-story__image"
          src={copy.image}
          alt="Students using KampusOne on campus"
          width={1024}
          height={1024}
          priority
        />
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <p className="auth-panel__kicker">Secure account access</p>
          <h2>
            {mode === "login"
              ? "Welcome back"
              : mode === "register"
                ? "Create your account"
                : mode === "verify"
                  ? "Verify your email"
                  : mode === "forgot"
                    ? "Recover your account"
                    : "Choose a new password"}
          </h2>
          <p className="muted">
            {mode === "login"
              ? "Use the email and password attached to your KampusOne identity."
              : mode === "register"
                ? "Every administrator and agent starts with a verified personal account."
                : mode === "forgot"
                  ? "Enter your account email. We never reveal whether an address is registered."
                  : "Only the unexpired code delivered to your inbox will be accepted."}
          </p>

          <form className="form-stack" onSubmit={submit}>
            {mode === "register" && (
              <div className="form-grid">
                <label>
                  First name
                  <input name="firstName" autoComplete="given-name" required />
                </label>
                <label>
                  Last name
                  <input name="lastName" autoComplete="family-name" required />
                </label>
              </div>
            )}
            {mode === "login" || mode === "register" || mode === "forgot" ? (
              <>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                {mode !== "forgot" && (
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      minLength={mode === "register" ? 10 : 1}
                      autoComplete={
                        mode === "register"
                          ? "new-password"
                          : "current-password"
                      }
                      required
                    />
                  </label>
                )}
                {mode === "register" && (
                  <p className="field-help">
                    Use at least 10 characters. By continuing, you agree to the
                    current KampusOne terms and privacy notice.
                  </p>
                )}
              </>
            ) : (
              <>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  Six-digit verification code
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="code-input"
                    required
                  />
                </label>
                {mode === "reset" && (
                  <label>
                    New password
                    <input
                      name="password"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                )}
              </>
            )}
            {notice && (
              <p className="form-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button--primary button--wide"
              disabled={busy}
            >
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in securely"
                  : mode === "register"
                    ? "Create account"
                    : mode === "verify"
                      ? "Verify and continue"
                      : mode === "forgot"
                        ? "Send reset code"
                        : "Update password"}
            </button>
          </form>

          {mode === "verify" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await webAuth.resend(email);
                  setNotice(
                    "If the account is awaiting verification, a new code is on its way.",
                  );
                } catch (caught) {
                  setError(messageFrom(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send a new code
            </button>
          )}
          {mode === "login" && (
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setNotice("");
                setMode("forgot");
              }}
            >
              Forgot your password?
            </button>
          )}
          <div className="auth-switch">
            <span>
              {mode === "login"
                ? "New to KampusOne?"
                : "Already have an account?"}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setNotice("");
                setMode(mode === "login" ? "register" : "login");
              }}
            >
              {mode === "login" ? "Create account" : "Sign in"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
