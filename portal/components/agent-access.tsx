"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";

import { AgentAccessIllustration } from "@/components/agent-illustrations";
import { type Session, PortalApiError, webAuth } from "@/lib/api";
import styles from "./agent-intake.module.css";

type Stage = "email" | "code";

function messageFrom(error: unknown) {
  return error instanceof PortalApiError
    ? error.message
    : "Something interrupted the request. Please try again.";
}

export function AgentAccess({
  onAuthenticated,
}: {
  onAuthenticated(session: Session): void;
}) {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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
      if (stage === "email") {
        const nextEmail = String(form.get("email")).trim().toLowerCase();
        await webAuth.requestEmailCode(nextEmail);
        setEmail(nextEmail);
        setCode("");
        setStage("code");
        setNotice("Check your email for the six-digit code.");
        return;
      }
      onAuthenticated(await webAuth.verifyEmailCode(email, code));
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await webAuth.requestEmailCode(email);
      setNotice("A new code has been requested.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.root}>
      <header className={styles.entryHeader}>
        <Image
          className={styles.logo}
          src="/brand/kampusone-horizontal-ink.svg"
          alt="KampusOne"
          width={190}
          height={46}
          priority
        />
      </header>
      <div className={styles.entryShell}>
        <section className={styles.entryCopy}>
          <p className={styles.kicker}>Agent network</p>
          <h1>Work with students on campus.</h1>
          <p>
            Apply as a vendor, tutor or rider with the KampusOne account you
            already use.
          </p>
          <div className={styles.entryArt}>
            <AgentAccessIllustration />
          </div>
        </section>

        <section
          className={styles.entryCard}
          aria-labelledby="agent-access-title"
        >
          <header>
            <p className="section-kicker">
              {stage === "email" ? "Sign in" : "Verification"}
            </p>
            <h2 id="agent-access-title">
              {stage === "email"
                ? "Continue with your email"
                : "Enter your code"}
            </h2>
            <p className="muted">
              {stage === "email"
                ? "Use the same email as your KampusOne account."
                : `We sent a six-digit code for ${email}.`}
            </p>
          </header>

          <form
            key={stage}
            className="form-stack agent-login-form"
            onSubmit={submit}
          >
            {stage === "email" ? (
              <label>
                Email address
                <span className="agent-login-input">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M4 6.75h16v10.5H4z" />
                    <path d="m4.75 7.5 7.25 5 7.25-5" />
                  </svg>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoFocus
                    required
                  />
                </span>
              </label>
            ) : (
              <label>
                Verification code
                <span className="agent-login-input">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <circle cx="8" cy="12" r="3.25" />
                    <path d="M11.25 12H20m-3 0v3m-3-3v2" />
                  </svg>
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="code-input"
                    placeholder="000000"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    autoFocus
                    required
                  />
                </span>
              </label>
            )}
            {notice && (
              <p className="form-notice" role="status" aria-live="polite">
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
                : stage === "email"
                  ? "Send code"
                  : "Continue"}
            </button>
          </form>

          {stage === "code" && (
            <div className="agent-auth-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setStage("email");
                  setNotice("");
                  setError("");
                }}
              >
                Use another email
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void resend()}
              >
                Send a new code
              </button>
            </div>
          )}
          <p className="agent-auth-help">
            New here? Create your KampusOne student account first, then come
            back with the same email.
          </p>
        </section>
      </div>
    </main>
  );
}
